import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let isLoaded = false;
let loadPromise: Promise<void> | null = null;
let progressHandler: ((p: number) => void) | null = null;
let logBuffer: string[] = [];

export const beginLogCapture = () => {
  logBuffer = [];
};

export const getCapturedLog = (lastN = 8): string => {
  return logBuffer.slice(-lastN).join("\n");
};

export const getFFmpeg = async (
  onProgress?: (progress: number) => void
): Promise<FFmpeg> => {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }) => {
      if (progressHandler) progressHandler(progress);
    });
    ffmpeg.on("log", ({ message }) => {
      logBuffer.push(message);
      if (logBuffer.length > 200) logBuffer.splice(0, logBuffer.length - 200);
    });
  }

  if (onProgress !== undefined) {
    progressHandler = onProgress;
  }

  if (isLoaded) return ffmpeg;

  if (!loadPromise) {
    loadPromise = (async () => {
      // Serve ffmpeg-core from our own origin (vite public/) — much faster than unpkg
      // and avoids the cross-origin slow-path entirely. Cached aggressively after first load.
      const baseURL = `${import.meta.env.BASE_URL}ffmpeg`;
      await ffmpeg!.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      isLoaded = true;
    })();
  }

  await loadPromise;
  return ffmpeg!;
};

export type OutputFormat = "same" | "mp3" | "flac" | "wav" | "m4a" | "ogg" | "opus";

export interface FormatInfo {
  ext: string;
  mime: string;
  label: string;
  description: string;
  lossless: boolean;
  supportsCoverArt: boolean;
  defaultBitrate?: number; // kbps for lossy
  bitrates?: number[];
}

export const FORMATS: Record<Exclude<OutputFormat, "same">, FormatInfo> = {
  mp3: {
    ext: "mp3",
    mime: "audio/mpeg",
    label: "MP3",
    description: "Universal compatibility",
    lossless: false,
    supportsCoverArt: true,
    defaultBitrate: 320,
    bitrates: [128, 192, 256, 320],
  },
  flac: {
    ext: "flac",
    mime: "audio/flac",
    label: "FLAC",
    description: "Lossless, smaller than WAV",
    lossless: true,
    supportsCoverArt: true,
  },
  wav: {
    ext: "wav",
    mime: "audio/wav",
    label: "WAV",
    description: "Uncompressed PCM",
    lossless: true,
    supportsCoverArt: false,
  },
  m4a: {
    ext: "m4a",
    mime: "audio/mp4",
    label: "M4A (AAC)",
    description: "Apple/Android friendly",
    lossless: false,
    supportsCoverArt: true,
    defaultBitrate: 256,
    bitrates: [128, 192, 256, 320],
  },
  ogg: {
    ext: "ogg",
    mime: "audio/ogg",
    label: "OGG Vorbis",
    description: "Open, efficient",
    lossless: false,
    supportsCoverArt: false,
    defaultBitrate: 224,
    bitrates: [128, 192, 224, 320],
  },
  opus: {
    ext: "opus",
    mime: "audio/opus",
    label: "Opus",
    description: "Best modern lossy codec",
    lossless: false,
    supportsCoverArt: false,
    defaultBitrate: 192,
    bitrates: [96, 128, 192, 256],
  },
};

export const codecArgsFor = (fmt: Exclude<OutputFormat, "same">, bitrate?: number): string[] => {
  const br = bitrate ?? FORMATS[fmt].defaultBitrate;
  switch (fmt) {
    case "mp3":
      return ["-c:a", "libmp3lame", "-b:a", `${br}k`];
    case "flac":
      return ["-c:a", "flac"];
    case "wav":
      return ["-c:a", "pcm_s16le"];
    case "m4a":
      return ["-c:a", "aac", "-b:a", `${br}k`];
    case "ogg":
      return ["-c:a", "libvorbis", "-b:a", `${br}k`];
    case "opus":
      return ["-c:a", "libopus", "-b:a", `${br}k`];
  }
};

// Cover art codec by container — re-encode to mjpeg for max compatibility
export const coverCodecFor = (fmt: Exclude<OutputFormat, "same">): string[] => {
  if (fmt === "flac") return ["-c:v", "copy"]; // FLAC handles png/jpg natively as METADATA_BLOCK_PICTURE
  return ["-c:v", "mjpeg"]; // mp3, m4a — mjpeg is the safest universally-readable choice
};
