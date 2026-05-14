import { useState, useCallback, useRef } from "react";
import { getFFmpeg, parseFFmetadata } from "@/lib/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import JSZip from "jszip";

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

export interface AudioFile {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  metadata?: Record<string, string>;
  customMetadata?: CustomMetadata;
  coverArt?: CoverArt;
  cleanedBlob?: Blob;
  error?: string;
}

export interface Options {
  keepBasicTags: boolean;
  removeCoverArt: boolean;
}

export const SUPPORTS_COVER_ART = new Set(["mp3", "flac", "m4a"]);

export const getExt = (name: string) => (name.split(".").pop() || "").toLowerCase();

const hasAnyCustom = (m?: CustomMetadata) =>
  !!m && Object.values(m).some((v) => v && v.trim() !== "");

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function useMetaClean() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const filesRef = useRef<AudioFile[]>([]);
  filesRef.current = files;

  const [options, setOptions] = useState<Options>({
    keepBasicTags: false,
    removeCoverArt: true,
  });
  const [isEngineLoading, setIsEngineLoading] = useState(false);

  const updateFile = useCallback((id: string, updates: Partial<AudioFile> | ((f: AudioFile) => Partial<AudioFile>)) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const u = typeof updates === "function" ? updates(f) : updates;
        return { ...f, ...u };
      })
    );
  }, []);

  const readMetadata = useCallback(async (id: string, file: File) => {
    updateFile(id, { status: "reading" });
    try {
      const ffmpeg = await getFFmpeg();
      const inputName = `in_${id}_${file.name}`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      try {
        await ffmpeg.exec(["-i", inputName, "-f", "ffmetadata", "metadata.txt"]);
      } catch {}

      let metadataStr = "";
      try {
        const metadataData = await ffmpeg.readFile("metadata.txt");
        metadataStr = new TextDecoder().decode(metadataData as Uint8Array);
      } catch {}

      const parsed = parseFFmetadata(metadataStr);

      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile("metadata.txt");
      } catch {}

      updateFile(id, { status: "ready", metadata: parsed });
    } catch (err: any) {
      console.error(err);
      updateFile(id, { status: "error", error: err.message || "Failed to read metadata" });
    }
  }, [updateFile]);

  const addFiles = useCallback(async (newFiles: File[]) => {
    const audioFiles: AudioFile[] = newFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "queued",
      progress: 0,
    }));

    setFiles((prev) => [...prev, ...audioFiles]);

    setIsEngineLoading(true);
    try {
      await getFFmpeg();
    } catch (err) {
      console.error("Failed to load FFmpeg", err);
    } finally {
      setIsEngineLoading(false);
    }

    for (const af of audioFiles) {
      await readMetadata(af.id, af.file);
    }
  }, [readMetadata]);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const setCustomMetadata = useCallback((id: string, patch: Partial<CustomMetadata>) => {
    updateFile(id, (f) => ({
      customMetadata: { ...(f.customMetadata ?? {}), ...patch },
    }));
  }, [updateFile]);

  const setCoverArt = useCallback(async (id: string, file: File) => {
    const dataUrl = await readFileAsDataUrl(file);
    updateFile(id, { coverArt: { file, dataUrl } });
  }, [updateFile]);

  const clearCoverArt = useCallback((id: string) => {
    updateFile(id, { coverArt: undefined });
  }, [updateFile]);

  const applyToAll = useCallback(async (sourceId: string) => {
    const src = filesRef.current.find((f) => f.id === sourceId);
    if (!src) return;
    setFiles((prev) =>
      prev.map((f) =>
        f.id === sourceId
          ? f
          : {
              ...f,
              customMetadata: src.customMetadata ? { ...src.customMetadata } : undefined,
              coverArt: src.coverArt ? { ...src.coverArt } : undefined,
            }
      )
    );
  }, []);

  const cleanFile = useCallback(async (id: string) => {
    const fileToClean = filesRef.current.find((f) => f.id === id);
    if (!fileToClean) return;
    if (fileToClean.status === "cleaning" || fileToClean.status === "done") return;

    updateFile(id, { status: "cleaning", progress: 0 });

    try {
      const ffmpeg = await getFFmpeg((progress) => {
        updateFile(id, { progress: Math.min(100, progress * 100) });
      });

      const ext = (fileToClean.file.name.split(".").pop() || "mp3").toLowerCase();
      const inputName = `clean_in_${id}.${ext}`;
      const outputName = `clean_out_${id}.${ext}`;

      await ffmpeg.writeFile(inputName, await fetchFile(fileToClean.file));

      const customs = hasAnyCustom(fileToClean.customMetadata) ? fileToClean.customMetadata! : undefined;
      const wantsCover = !!fileToClean.coverArt && SUPPORTS_COVER_ART.has(ext);

      let coverName: string | null = null;
      if (wantsCover && fileToClean.coverArt) {
        const cExt = fileToClean.coverArt.file.name.split(".").pop()?.toLowerCase() || "jpg";
        coverName = `cover_${id}.${cExt}`;
        await ffmpeg.writeFile(coverName, await fetchFile(fileToClean.coverArt.file));
      }

      const args: string[] = ["-i", inputName];
      if (coverName) args.push("-i", coverName);

      args.push("-map_metadata", "-1");

      if (coverName) {
        args.push("-map", "0:a", "-map", "1:0");
      } else if (options.removeCoverArt) {
        args.push("-vn");
      }
      // else: leave default mapping so existing cover art (if any) is preserved

      // Apply custom metadata (overrides keep-basic option)
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

      args.push("-c", "copy");

      if (coverName) {
        args.push("-disposition:v", "attached_pic");
        args.push("-metadata:s:v", "title=Album cover");
        args.push("-metadata:s:v", "comment=Cover (front)");
        if (ext === "mp3") {
          args.push("-id3v2_version", "3");
        }
      }

      if (ext === "m4a") {
        args.push("-movflags", "+faststart");
      }

      args.push(outputName);

      await ffmpeg.exec(args);

      const outData = await ffmpeg.readFile(outputName);
      const u8 = outData as Uint8Array;
      const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
      const blob = new Blob([buf], { type: fileToClean.file.type });

      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
        if (coverName) await ffmpeg.deleteFile(coverName);
      } catch {}

      updateFile(id, { status: "done", progress: 100, cleanedBlob: blob });
    } catch (err: any) {
      console.error(err);
      updateFile(id, { status: "error", error: err.message || "Failed to clean file" });
    }
  }, [options, updateFile]);

  const cleanAll = useCallback(async () => {
    const toClean = filesRef.current
      .filter((f) => f.status === "queued" || f.status === "ready")
      .map((f) => f.id);
    for (const id of toClean) {
      await cleanFile(id);
    }
  }, [cleanFile]);

  const downloadFile = useCallback((id: string) => {
    const file = filesRef.current.find((f) => f.id === id);
    if (!file || !file.cleanedBlob) return;

    const url = URL.createObjectURL(file.cleanedBlob);
    const a = document.createElement("a");
    a.href = url;

    const lastDot = file.file.name.lastIndexOf(".");
    const base = lastDot !== -1 ? file.file.name.substring(0, lastDot) : file.file.name;
    const ext = lastDot !== -1 ? file.file.name.substring(lastDot) : "";

    a.download = `${base}-clean${ext}`;
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
    doneFiles.forEach((file) => {
      const lastDot = file.file.name.lastIndexOf(".");
      const base = lastDot !== -1 ? file.file.name.substring(0, lastDot) : file.file.name;
      const ext = lastDot !== -1 ? file.file.name.substring(lastDot) : "";
      zip.file(`${base}-clean${ext}`, file.cleanedBlob!);
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
    addFiles,
    removeFile,
    cleanFile,
    cleanAll,
    downloadFile,
    downloadAll,
    setCustomMetadata,
    setCoverArt,
    clearCoverArt,
    applyToAll,
  };
}
