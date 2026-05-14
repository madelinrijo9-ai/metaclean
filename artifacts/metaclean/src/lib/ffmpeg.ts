import { FFmpeg } from "@ffmpeg/ffmpeg";

// Bump when @ffmpeg/core is upgraded — also acts as a cache-buster so users
// with stale cached copies of the old UMD core file get the new ESM core.
const CORE_VERSION = "0.12.10-esm-1";

async function verifyAsset(url: string): Promise<void> {
  // Cheap sanity check that fails fast with a clear, actionable message
  // when the deployment misconfigures static serving (e.g. SPA fallback to
  // index.html, or assets not copied into the build output).
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", cache: "force-cache" });
  } catch (e) {
    throw new Error(
      `Could not fetch ${url}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `Engine asset ${url} returned HTTP ${res.status}. The deployment is missing this file.`,
    );
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/html")) {
    throw new Error(
      `Engine asset ${url} returned HTML (content-type: ${ct}). The deployment is rewriting static-file requests to index.html.`,
    );
  }
  // Drain body so the browser caches it; the worker will refetch from cache.
  await res.arrayBuffer();
}

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
      // We ship the ESM build of @ffmpeg/core (which exports a `default` factory)
      // because @ffmpeg/ffmpeg's worker is `type: "module"` and uses
      // `(await import(coreURL)).default` to get the factory. The UMD build has
      // no `export default` and would silently produce `failed to import ffmpeg-core.js`.
      // Files are copied from node_modules into public/ffmpeg/ at build time.
      const baseURL = `${import.meta.env.BASE_URL}ffmpeg`;
      const coreURL = `${baseURL}/ffmpeg-core.js?v=${CORE_VERSION}`;
      const wasmURL = `${baseURL}/ffmpeg-core.wasm?v=${CORE_VERSION}`;

      // Pre-flight: verify both assets are actually served as expected.
      // Fails fast with a precise error if the deployment is broken.
      await Promise.all([verifyAsset(coreURL), verifyAsset(wasmURL)]);

      await ffmpeg!.load({ coreURL, wasmURL });
      isLoaded = true;
    })();
  }

  await loadPromise;
  return ffmpeg!;
};

// Tear down the singleton so the next getFFmpeg() builds a fresh instance with
// a clean WASM heap. Required after large encodes — ffmpeg.wasm's MEMFS + libav
// allocators don't shrink, so cumulative state across many large files
// eventually causes "memory access out of bounds" mid-encode.
export const resetFFmpeg = async (): Promise<void> => {
  const inst = ffmpeg;
  ffmpeg = null;
  isLoaded = false;
  loadPromise = null;
  progressHandler = null;
  if (inst) {
    try {
      inst.terminate();
    } catch {
      // ignore — instance may already be dead
    }
  }
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
