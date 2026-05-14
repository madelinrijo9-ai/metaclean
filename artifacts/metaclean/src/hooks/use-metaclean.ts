import { useState, useCallback, useRef, useEffect } from "react";
import { parseBlob, type IAudioMetadata } from "music-metadata";
import { fetchFile } from "@ffmpeg/util";
import JSZip from "jszip";
import {
  getFFmpeg,
  resetFFmpeg,
  beginLogCapture,
  getCapturedLog,
  FORMATS,
  codecArgsFor,
  coverCodecFor,
  encoderSpoofArgs,
  type OutputFormat,
} from "@/lib/ffmpeg";
import { parseWavToPcm, wrapPcmAsWav, type WavInfo } from "@/lib/wav";

// Reset the ffmpeg.wasm engine after this much cumulative input has been
// processed. The WASM heap doesn't shrink between encodes, so long queues of
// large files (e.g. 11x 30 MB WAVs) eventually hit "memory access out of
// bounds". 60 MB is a safe budget that keeps small files snappy and forces a
// fresh instance before any single large file would push us past the limit.
const FFMPEG_RESET_BYTES = 60 * 1024 * 1024;

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
  // ID of the encoder spoof preset (see ENCODER_PRESETS). "default" leaves
  // ffmpeg's auto-stamp ("Lavf…") in place; "blank" strips it; any other id
  // writes that DAW's signature into the encoder tag.
  encoderSpoof: string;
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
    encoderSpoof: "default",
  });
  const [isEngineLoading, setIsEngineLoading] = useState(true);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const cleanLockRef = useRef<Promise<void>>(Promise.resolve());
  const bytesSinceResetRef = useRef<number>(0);

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

  const setOutputBitrateAll = useCallback((br: number | undefined) => {
    setFiles((prev) => prev.map((f) => ({ ...f, outputBitrate: br })));
  }, []);

  const setEncoderSpoof = useCallback((id: string) => {
    setOptionsState((p) => ({ ...p, encoderSpoof: id }));
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

      let phase = "init";
      const describeError = (e: any): string => {
        if (!e) return "unknown error";
        if (typeof e === "string") return e;
        if (e instanceof Error && e.message) return e.message;
        if (e?.message) return String(e.message);
        try {
          const s = JSON.stringify(e);
          if (s && s !== "{}") return s;
        } catch {}
        return String(e);
      };

      // Proactively recycle the WASM engine before processing this file if
      // the running heap is approaching the safe budget. Doing it BEFORE the
      // encode (rather than after) means the next file always starts on a
      // fresh, predictable heap instead of inheriting fragmented allocations.
      if (bytesSinceResetRef.current + fileToClean.file.size > FFMPEG_RESET_BYTES) {
        try {
          await resetFFmpeg();
        } catch (e) {
          console.warn("resetFFmpeg failed (continuing with fresh load)", e);
        }
        bytesSinceResetRef.current = 0;
      }

      const loadEngine = () =>
        getFFmpeg((progress) => {
          updateFile(id, { progress: Math.min(100, Math.max(0, progress * 100)) });
        });

      try {
        beginLogCapture();
        phase = "load engine";
        let ffmpeg = await loadEngine();

        const inExt = getExt(fileToClean.file.name);

        const outFmt: Exclude<OutputFormat, "same"> =
          fileToClean.outputFormat === "same"
            ? ((SUPPORTED_INPUT_EXTS.has(inExt) && (FORMATS as any)[inExt]) ? (inExt as any) : "mp3")
            : fileToClean.outputFormat;

        const outExt = FORMATS[outFmt].ext;
        const outputName = `out_${id.slice(0, 8)}.${outExt}`;
        const sameContainer = inExt === outExt;

        // For WAV inputs we parse the RIFF in JS to extract just the PCM
        // payload, then re-wrap it in a freshly-built minimal RIFF/WAVE
        // container (RIFF + fmt + data, nothing else). ffmpeg sees a
        // pristine WAV file via its well-tested WAV demuxer — no LIST/INFO
        // chunks, no junk, no chance of the libavformat allocator tripping
        // on Suno/Udio's malformed metadata blocks. The wrapped buffer is
        // freshly allocated each time, so the worker's transferable transfer
        // doesn't disturb our master copy.
        // Same-format WAV→WAV stays on the regular path (no decode needed).
        let useCleanWav = false;
        let rawWav: WavInfo | null = null;
        if (inExt === "wav" && !sameContainer) {
          phase = "parse wav header";
          try {
            rawWav = await parseWavToPcm(fileToClean.file);
            useCleanWav = true;
          } catch (e) {
            console.warn(
              "[MetaClean] Could not parse WAV header in JS; falling back to ffmpeg's demuxer",
              e
            );
          }
        }

        const inputName = useCleanWav
          ? `clean_${id.slice(0, 8)}.wav`
          : `in_${id.slice(0, 8)}.${inExt || "bin"}`;

        if (useCleanWav) {
          const cleanWav = wrapPcmAsWav(rawWav!);
          phase = `write input (clean wav, ${cleanWav.byteLength}b)`;
          await ffmpeg.writeFile(inputName, cleanWav);
        } else {
          phase = `write input (${inExt || "?"}, ${fileToClean.file.size}b)`;
          await ffmpeg.writeFile(inputName, await fetchFile(fileToClean.file));
        }

        const customs = hasAnyCustom(fileToClean.customMetadata)
          ? fileToClean.customMetadata!
          : undefined;

        const wantsCustomCover =
          !!fileToClean.coverArt && FORMATS[outFmt].supportsCoverArt;

        let coverName: string | null = null;
        if (wantsCustomCover && fileToClean.coverArt) {
          phase = "write cover";
          const cExt = getExt(fileToClean.coverArt.file.name) || "jpg";
          coverName = `cov_${id.slice(0, 8)}.${cExt}`;
          await ffmpeg.writeFile(coverName, await fetchFile(fileToClean.coverArt.file));
        }

        const args: string[] = [];
        // Be lenient with malformed input headers/chunks (e.g. odd MP3
        // frames, broken FLAC seektables). Cheap insurance for the regular
        // demuxer path; harmless for our freshly-wrapped clean WAVs.
        args.push("-err_detect", "ignore_err");
        args.push("-fflags", "+discardcorrupt");
        args.push("-i", inputName);
        if (coverName) args.push("-i", coverName);

        // Strip all metadata first
        args.push("-map_metadata", "-1");

        // Stream mapping — always explicit so behavior is deterministic.
        // Our wrapped clean WAV has no cover stream, so preserve-original
        // is never applicable on that path.
        const preserveOriginalCover =
          !useCleanWav &&
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

        // Encoder-tag spoof — appended last so its -metadata wins, and so
        // -bitexact applies to the muxer that's about to write the file.
        args.push(...encoderSpoofArgs(options.encoderSpoof));

        args.push("-y", outputName);

        const isMemoryError = (e: any): boolean => {
          const s = describeError(e).toLowerCase();
          return (
            s.includes("memory access out of bounds") ||
            s.includes("out of memory") ||
            s.includes("aborted") ||
            s.includes("rangeerror")
          );
        };

        // Run the encode, recovering once from a WASM heap fault by tearing
        // down the engine, reloading, re-uploading the inputs, and retrying.
        // This handles cases where prior encodes left the heap in a bad state
        // even though our budget-based recycle didn't trip.
        const runExecWithRecovery = async (
          execArgs: string[]
        ): Promise<{ rc: number; err: any }> => {
          beginLogCapture();
          let err: any = null;
          let rc = 0;
          try {
            rc = await ffmpeg.exec(execArgs);
          } catch (e) {
            err = e;
            rc = -1;
          }
          if (rc !== 0 && isMemoryError(err || getCapturedLog(20))) {
            console.warn("[MetaClean] OOM detected, recycling engine and retrying", {
              err,
              tail: getCapturedLog(10),
            });
            try {
              await resetFFmpeg();
            } catch {}
            bytesSinceResetRef.current = 0;
            ffmpeg = await loadEngine();
            // Re-upload inputs into the fresh MEMFS. For WAV inputs, rebuild
            // a fresh clean-WAV from our parsed PCM (the previous wrapper's
            // buffer was transferred to the worker and is now detached).
            if (useCleanWav && rawWav) {
              await ffmpeg.writeFile(inputName, wrapPcmAsWav(rawWav));
            } else {
              await ffmpeg.writeFile(inputName, await fetchFile(fileToClean.file));
            }
            if (coverName && fileToClean.coverArt) {
              await ffmpeg.writeFile(
                coverName,
                await fetchFile(fileToClean.coverArt.file)
              );
            }
            beginLogCapture();
            err = null;
            rc = 0;
            try {
              rc = await ffmpeg.exec(execArgs);
            } catch (e) {
              err = e;
              rc = -1;
            }
          }
          return { rc, err };
        };

        phase = `exec (${useCleanWav ? "clean wav" : inExt}→${outExt}, ${
          sameContainer ? "copy" : "encode"
        })`;
        const first = await runExecWithRecovery(args);
        const execErrorOnce: any = first.err;
        let rc = first.rc;

        if (rc !== 0) {
          // Same-container lossless can fall back to an explicit re-encode
          // (Suno/Udio WAVs sometimes break `-c:a copy` even when remuxed).
          const canReencodeRetry = sameContainer && FORMATS[outFmt].lossless;
          console.error("ffmpeg first attempt failed", {
            rc,
            execErrorOnce,
            log: getCapturedLog(15),
            args,
          });
          if (canReencodeRetry) {
            phase = `retry exec (${inExt}→${outExt}, re-encode)`;
            const retry = args.filter((v, i, arr) => {
              if (v === "-c:a" && arr[i + 1] === "copy") return false;
              if (i > 0 && arr[i - 1] === "-c:a" && v === "copy") return false;
              return true;
            });
            const yIdx = retry.indexOf("-y");
            retry.splice(yIdx, 0, ...codecArgsFor(outFmt, fileToClean.outputBitrate));
            const second = await runExecWithRecovery(retry);
            if (second.rc !== 0) {
              const tail = getCapturedLog(20);
              const last = tail.split("\n").filter(Boolean).slice(-2).join(" | ");
              throw new Error(
                `ffmpeg retry exited ${second.rc}${last ? ` — ${last}` : ""}`
              );
            }
          } else {
            const tail = getCapturedLog(20);
            const last = tail.split("\n").filter(Boolean).slice(-2).join(" | ");
            const base = execErrorOnce ? describeError(execErrorOnce) : `ffmpeg exited ${rc}`;
            throw new Error(`${base}${last ? ` — ${last}` : ""}`);
          }
        }

        phase = "read output";
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

        bytesSinceResetRef.current += fileToClean.file.size;

        updateFile(id, {
          status: "done",
          progress: 100,
          cleanedBlob: blob,
          cleanedExt: outExt,
        });
      } catch (err: any) {
        const tail = getCapturedLog(20);
        console.error("[MetaClean] Clean failed", {
          phase,
          err,
          stringified: describeError(err),
          ffmpegLog: tail,
        });
        const detail = describeError(err);
        const msg = `[${phase}] ${detail}`;
        updateFile(id, {
          status: "error",
          error: msg,
        });
        // The engine may be in a corrupted state after a failure (especially
        // a WASM heap fault). Tear it down so the next file starts on a
        // fresh, predictable instance instead of cascading the same error.
        try {
          await resetFFmpeg();
        } catch {}
        bytesSinceResetRef.current = 0;
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
    setOutputBitrateAll,
    setEncoderSpoof,
  };
}
