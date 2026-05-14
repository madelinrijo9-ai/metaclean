import { useState, useCallback, useRef, useEffect } from "react";
import { parseBlob, type IAudioMetadata } from "music-metadata";
import { fetchFile } from "@ffmpeg/util";
import JSZip from "jszip";
import {
  getFFmpeg,
  FORMATS,
  codecArgsFor,
  coverCodecFor,
  type OutputFormat,
} from "@/lib/ffmpeg";

export type FileStatus = "queued" | "reading" | "ready" | "cleaning" | "done" | "error";

export interface CustomMetadata {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: string;
  genre?: string;
  track?: string;
  comment?: string;
}

export interface CoverArt {
  file: File;
  dataUrl: string;
}

export interface AudioInfo {
  durationSec?: number;
  bitrateKbps?: number;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  container?: string;
}

export interface AudioFile {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  metadata?: Record<string, string>;
  originalCoverDataUrl?: string;
  audioInfo?: AudioInfo;
  customMetadata?: CustomMetadata;
  coverArt?: CoverArt;
  outputFormat: OutputFormat;
  outputBitrate?: number;
  cleanedBlob?: Blob;
  cleanedExt?: string;
  error?: string;
}

export interface Options {
  keepBasicTags: boolean;
  removeCoverArt: boolean;
  defaultOutputFormat: OutputFormat;
}

export const SUPPORTS_COVER_ART_INPUT = new Set(["mp3", "flac", "m4a"]);
export const getExt = (name: string) => (name.split(".").pop() || "").toLowerCase();

const hasAnyCustom = (m?: CustomMetadata) =>
  !!m && Object.values(m).some((v) => v && String(v).trim() !== "");

function readFileAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function uint8ToDataUrl(data: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(data.subarray(i, i + chunk))
    );
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function flattenMusicMetadata(meta: IAudioMetadata): Record<string, string> {
  const out: Record<string, string> = {};
  const c = meta.common;
  if (c.title) out.title = c.title;
  if (c.artist) out.artist = c.artist;
  if (c.albumartist) out.album_artist = c.albumartist;
  if (c.album) out.album = c.album;
  if (c.year) out.year = String(c.year);
  if (c.date) out.date = c.date;
  if (c.genre?.length) out.genre = c.genre.join(", ");
  if (c.track?.no != null) out.track = `${c.track.no}${c.track.of ? `/${c.track.of}` : ""}`;
  if (c.disk?.no != null) out.disc = `${c.disk.no}${c.disk.of ? `/${c.disk.of}` : ""}`;
  if (c.composer?.length) out.composer = c.composer.join(", ");
  if (c.comment?.length) {
    const v = (c.comment[0] as any)?.text ?? c.comment[0];
    if (typeof v === "string") out.comment = v;
  }
  if (c.encodedby) out.encoded_by = c.encodedby;
  if (c.encodersettings) out.encoder_settings = c.encodersettings;
  if ((c as any).tool) out.tool = (c as any).tool;
  if ((c as any).description) out.description = (c as any).description;
  if (c.copyright) out.copyright = c.copyright;
  if (c.isrc?.length) out.isrc = c.isrc.join(", ");
  if (c.bpm) out.bpm = String(c.bpm);

  // Native tag scan — pick up generator/AI fingerprints that aren't in `common`
  const seen = new Set<string>(Object.keys(out));
  const aiHints = /^(tsse|tenc|tssw|generator|software|tool|encoder|comment|description|prompt|model|suno|udio|ai)/i;
  for (const tags of Object.values(meta.native ?? {})) {
    for (const t of tags as Array<{ id: string; value: any }>) {
      const id = String(t.id || "").toLowerCase();
      if (!aiHints.test(id)) continue;
      const v = typeof t.value === "string" ? t.value : (t.value?.text ?? "");
      if (!v || seen.has(id)) continue;
      out[id] = String(v).slice(0, 200);
      seen.add(id);
    }
  }

  return out;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

const SUPPORTED_INPUT_EXTS = new Set([
  "mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "wma", "mp4", "webm",
]);

export function useMetaClean() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const filesRef = useRef<AudioFile[]>([]);
  filesRef.current = files;

  const [options, setOptionsState] = useState<Options>({
    keepBasicTags: false,
    removeCoverArt: true,
    defaultOutputFormat: "same",
  });
  const [isEngineLoading, setIsEngineLoading] = useState(true);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const cleanLockRef = useRef<Promise<void>>(Promise.resolve());

  // Preload ffmpeg.wasm immediately on mount so it's ready before the user clicks Clean
  useEffect(() => {
    let cancelled = false;
    getFFmpeg()
      .then(() => {
        if (!cancelled) setIsEngineReady(true);
      })
      .catch((err) => console.error("Failed to preload FFmpeg", err))
      .finally(() => {
        if (!cancelled) setIsEngineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setOptions = useCallback(
    (updater: Options | ((prev: Options) => Options)) => {
      setOptionsState((prev) =>
        typeof updater === "function" ? (updater as any)(prev) : updater
      );
    },
    []
  );

  const updateFile = useCallback(
    (id: string, updates: Partial<AudioFile> | ((f: AudioFile) => Partial<AudioFile>)) => {
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== id) return f;
          const u = typeof updates === "function" ? updates(f) : updates;
          return { ...f, ...u };
        })
      );
    },
    []
  );

  const readMetadata = useCallback(
    async (id: string, file: File) => {
      updateFile(id, { status: "reading" });
      try {
        const meta = await parseBlob(file);
        const tagMap = flattenMusicMetadata(meta);

        let coverDataUrl: string | undefined;
        const pic = meta.common.picture?.[0];
        if (pic?.data) {
          const u8 =
            pic.data instanceof Uint8Array ? pic.data : new Uint8Array(pic.data);
          coverDataUrl = uint8ToDataUrl(u8, pic.format || "image/jpeg");
        }

        const info: AudioInfo = {
          durationSec: meta.format.duration,
          bitrateKbps: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : undefined,
          sampleRate: meta.format.sampleRate,
          channels: meta.format.numberOfChannels,
          codec: meta.format.codec,
          container: meta.format.container,
        };

        updateFile(id, {
          status: "ready",
          metadata: tagMap,
          originalCoverDataUrl: coverDataUrl,
          audioInfo: info,
        });
      } catch (err: any) {
        console.warn("music-metadata failed, file will still be cleanable", err);
        updateFile(id, { status: "ready", metadata: {} });
      }
    },
    [updateFile]
  );

  const addFiles = useCallback(
    async (newFiles: File[]) => {
      const accepted = newFiles.filter((f) => SUPPORTED_INPUT_EXTS.has(getExt(f.name)));

      const audioFiles: AudioFile[] = accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "queued",
        progress: 0,
        outputFormat: options.defaultOutputFormat,
      }));

      setFiles((prev) => [...prev, ...audioFiles]);

      // Read metadata in parallel — much faster than ffmpeg roundtrip
      await Promise.all(audioFiles.map((af) => readMetadata(af.id, af.file)));
    },
    [readMetadata, options.defaultOutputFormat]
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
  }, []);

  const setCustomMetadata = useCallback(
    (id: string, patch: Partial<CustomMetadata>) => {
      updateFile(id, (f) => ({
        customMetadata: { ...(f.customMetadata ?? {}), ...patch },
      }));
    },
    [updateFile]
  );

  const setCoverArt = useCallback(
    async (id: string, file: File) => {
      const dataUrl = await readFileAsDataUrl(file);
      updateFile(id, { coverArt: { file, dataUrl } });
    },
    [updateFile]
  );

  const setCoverArtFromDataUrl = useCallback(
    async (id: string, dataUrl: string, fileName = "cover.jpg") => {
      try {
        if (!dataUrl.startsWith("data:")) {
          throw new Error("Invalid data URL");
        }
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], fileName, { type: blob.type || "image/jpeg" });
        updateFile(id, { coverArt: { file, dataUrl } });
      } catch (err) {
        console.error("Failed to set cover art from data URL", err);
        throw err;
      }
    },
    [updateFile]
  );

  const clearCoverArt = useCallback(
    (id: string) => {
      updateFile(id, { coverArt: undefined });
    },
    [updateFile]
  );

  const setOutputFormat = useCallback(
    (id: string, fmt: OutputFormat) => {
      updateFile(id, { outputFormat: fmt, outputBitrate: undefined });
    },
    [updateFile]
  );

  const setOutputBitrate = useCallback(
    (id: string, br: number | undefined) => {
      updateFile(id, { outputBitrate: br });
    },
    [updateFile]
  );

  const setOutputFormatAll = useCallback((fmt: OutputFormat) => {
    setFiles((prev) => prev.map((f) => ({ ...f, outputFormat: fmt, outputBitrate: undefined })));
    setOptionsState((p) => ({ ...p, defaultOutputFormat: fmt }));
  }, []);

  const applyToAll = useCallback((sourceId: string) => {
    const src = filesRef.current.find((f) => f.id === sourceId);
    if (!src) return;
    setFiles((prev) =>
      prev.map((f) =>
        f.id === sourceId
          ? f
          : {
              ...f,
              customMetadata: src.customMetadata
                ? { ...src.customMetadata }
                : undefined,
              coverArt: src.coverArt ? { ...src.coverArt } : undefined,
            }
      )
    );
  }, []);

  const cleanFile = useCallback(
    async (id: string) => {
      const fileToClean = filesRef.current.find((f) => f.id === id);
      if (!fileToClean) return;
      if (fileToClean.status === "cleaning") return;

      // Serialize all cleans against the singleton ffmpeg instance
      const release = cleanLockRef.current;
      let resolveNext!: () => void;
      cleanLockRef.current = new Promise<void>((r) => {
        resolveNext = r;
      });
      await release;

      updateFile(id, { status: "cleaning", progress: 0, cleanedBlob: undefined, error: undefined });

      try {
        const ffmpeg = await getFFmpeg((progress) => {
          updateFile(id, { progress: Math.min(100, Math.max(0, progress * 100)) });
        });

        const inExt = getExt(fileToClean.file.name);
        const inputName = `in_${id.slice(0, 8)}.${inExt || "bin"}`;

        const outFmt: Exclude<OutputFormat, "same"> =
          fileToClean.outputFormat === "same"
            ? ((SUPPORTED_INPUT_EXTS.has(inExt) && (FORMATS as any)[inExt]) ? (inExt as any) : "mp3")
            : fileToClean.outputFormat;

        const outExt = FORMATS[outFmt].ext;
        const outputName = `out_${id.slice(0, 8)}.${outExt}`;
        const sameContainer = inExt === outExt;

        await ffmpeg.writeFile(inputName, await fetchFile(fileToClean.file));

        const customs = hasAnyCustom(fileToClean.customMetadata)
          ? fileToClean.customMetadata!
          : undefined;

        const wantsCustomCover =
          !!fileToClean.coverArt && FORMATS[outFmt].supportsCoverArt;

        let coverName: string | null = null;
        if (wantsCustomCover && fileToClean.coverArt) {
          const cExt = getExt(fileToClean.coverArt.file.name) || "jpg";
          coverName = `cov_${id.slice(0, 8)}.${cExt}`;
          await ffmpeg.writeFile(coverName, await fetchFile(fileToClean.coverArt.file));
        }

        const args: string[] = ["-i", inputName];
        if (coverName) args.push("-i", coverName);

        // Strip all metadata first
        args.push("-map_metadata", "-1");

        // Stream mapping — always explicit so behavior is deterministic
        const preserveOriginalCover =
          !coverName &&
          !options.removeCoverArt &&
          FORMATS[outFmt].supportsCoverArt &&
          !!fileToClean.originalCoverDataUrl;

        args.push("-map", "0:a:0");
        if (coverName) {
          args.push("-map", "1:0");
        } else if (preserveOriginalCover) {
          args.push("-map", "0:v?");
        }

        // Apply tags (custom overrides keep-basic)
        if (customs) {
          if (customs.title) args.push("-metadata", `title=${customs.title}`);
          if (customs.artist) args.push("-metadata", `artist=${customs.artist}`);
          if (customs.album) args.push("-metadata", `album=${customs.album}`);
          if (customs.albumArtist) args.push("-metadata", `album_artist=${customs.albumArtist}`);
          if (customs.year) args.push("-metadata", `date=${customs.year}`);
          if (customs.genre) args.push("-metadata", `genre=${customs.genre}`);
          if (customs.track) args.push("-metadata", `track=${customs.track}`);
          if (customs.comment) args.push("-metadata", `comment=${customs.comment}`);
        } else if (options.keepBasicTags && fileToClean.metadata) {
          if (fileToClean.metadata.title) args.push("-metadata", `title=${fileToClean.metadata.title}`);
          if (fileToClean.metadata.artist) args.push("-metadata", `artist=${fileToClean.metadata.artist}`);
          if (fileToClean.metadata.album) args.push("-metadata", `album=${fileToClean.metadata.album}`);
        }

        // Codec selection
        if (sameContainer) {
          args.push("-c:a", "copy");
        } else {
          args.push(...codecArgsFor(outFmt, fileToClean.outputBitrate));
        }

        // Cover stream codec & disposition (custom or preserved-original)
        if (coverName || preserveOriginalCover) {
          if (sameContainer && preserveOriginalCover) {
            args.push("-c:v", "copy");
          } else {
            args.push(...coverCodecFor(outFmt));
          }
          args.push("-disposition:v", "attached_pic");
          args.push("-metadata:s:v", "title=Album cover");
          args.push("-metadata:s:v", "comment=Cover (front)");
          if (outExt === "mp3") args.push("-id3v2_version", "3");
        }

        if (outExt === "m4a") {
          args.push("-movflags", "+faststart");
        }

        args.push("-y", outputName);

        await ffmpeg.exec(args);

        const outData = (await ffmpeg.readFile(outputName)) as Uint8Array;
        const buf = outData.buffer.slice(
          outData.byteOffset,
          outData.byteOffset + outData.byteLength
        ) as ArrayBuffer;
        const blob = new Blob([buf], { type: FORMATS[outFmt].mime });

        try {
          await ffmpeg.deleteFile(inputName);
          await ffmpeg.deleteFile(outputName);
          if (coverName) await ffmpeg.deleteFile(coverName);
        } catch {}

        updateFile(id, {
          status: "done",
          progress: 100,
          cleanedBlob: blob,
          cleanedExt: outExt,
        });
      } catch (err: any) {
        console.error(err);
        updateFile(id, {
          status: "error",
          error: err?.message || "Failed to clean file",
        });
      } finally {
        resolveNext();
      }
    },
    [options, updateFile]
  );

  const cleanAll = useCallback(async () => {
    const toClean = filesRef.current
      .filter((f) => f.status === "queued" || f.status === "ready" || f.status === "error")
      .map((f) => f.id);
    for (const id of toClean) {
      await cleanFile(id);
    }
  }, [cleanFile]);

  const buildOutputName = (file: AudioFile) => {
    const lastDot = file.file.name.lastIndexOf(".");
    const base = lastDot !== -1 ? file.file.name.substring(0, lastDot) : file.file.name;
    const ext = file.cleanedExt || getExt(file.file.name);
    return `${base}-clean.${ext}`;
  };

  const downloadFile = useCallback((id: string) => {
    const file = filesRef.current.find((f) => f.id === id);
    if (!file || !file.cleanedBlob) return;

    const url = URL.createObjectURL(file.cleanedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildOutputName(file);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const downloadAll = useCallback(async () => {
    const doneFiles = filesRef.current.filter((f) => f.status === "done" && f.cleanedBlob);
    if (doneFiles.length === 0) return;

    if (doneFiles.length === 1) {
      downloadFile(doneFiles[0].id);
      return;
    }

    const zip = new JSZip();
    const used = new Map<string, number>();
    doneFiles.forEach((file) => {
      let name = buildOutputName(file);
      const safe = safeName(name);
      const count = used.get(safe) ?? 0;
      if (count > 0) {
        const dot = safe.lastIndexOf(".");
        name = dot > 0 ? `${safe.slice(0, dot)} (${count}).${safe.slice(dot + 1)}` : `${safe} (${count})`;
      } else {
        name = safe;
      }
      used.set(safe, count + 1);
      zip.file(name, file.cleanedBlob!);
    });

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = "metaclean-audio.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [downloadFile]);

  return {
    files,
    options,
    setOptions,
    isEngineLoading,
    isEngineReady,
    addFiles,
    removeFile,
    clearAll,
    cleanFile,
    cleanAll,
    downloadFile,
    downloadAll,
    setCustomMetadata,
    setCoverArt,
    setCoverArtFromDataUrl,
    clearCoverArt,
    applyToAll,
    setOutputFormat,
    setOutputBitrate,
    setOutputFormatAll,
  };
}
