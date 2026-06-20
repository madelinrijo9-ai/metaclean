import { FFmpeg } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

async function verifyAsset(url: string): Promise<void> {
  // Cheap sanity check that fails fast with a clear, actionable message
  // when the deployment misconfigures static serving (e.g. SPA fallback to
  // index.html, or assets not copied into the build output).
  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
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

// Encoder-tag spoofing presets. ffmpeg writes its own `encoder` tag (e.g.
// "Lavf60.16.100") unless we override it. These values mimic real DAW exports
// so the cleaned file doesn't fingerprint as ffmpeg.
//   id "default" → leave ffmpeg's tag in place (no override)
//   id "blank"   → suppress the tag entirely (uses -bitexact)
//   any other    → write the value into the encoder field
export interface EncoderPreset {
  id: string;
  label: string;
  value?: string; // undefined for "default" / "blank" sentinels
  group?: "Default" | "DAW" | "Editor";
}

export const ENCODER_PRESETS: EncoderPreset[] = [
  { id: "default", label: "ffmpeg default (no spoof)", group: "Default" },
  { id: "blank", label: "Strip encoder tag entirely", group: "Default" },
  { id: "fl-studio-21", label: "FL Studio 21", value: "FL Studio (21.2.3 [Build 4004])", group: "DAW" },
  { id: "logic-pro-11", label: "Logic Pro 11", value: "Logic Pro 11.1.0", group: "DAW" },
  { id: "ableton-live-12", label: "Ableton Live 12", value: "Ableton Live 12.1", group: "DAW" },
  { id: "pro-tools-2024", label: "Pro Tools 2024", value: "Pro Tools 2024.6.0", group: "DAW" },
  { id: "cubase-13", label: "Cubase 13", value: "Cubase 13.0.40", group: "DAW" },
  { id: "studio-one-7", label: "Studio One 7", value: "Studio One 7.0.2", group: "DAW" },
  { id: "reaper-7", label: "REAPER 7", value: "REAPER 7.18/x64", group: "DAW" },
  { id: "garageband", label: "GarageBand 10", value: "GarageBand 10.4.11", group: "DAW" },
  { id: "bitwig-5", label: "Bitwig Studio 5", value: "Bitwig Studio 5.2", group: "DAW" },
  { id: "audacity", label: "Audacity 3.5", value: "Audacity 3.5.1", group: "Editor" },
  { id: "adobe-audition", label: "Adobe Audition 2024", value: "Adobe Audition 24.6", group: "Editor" },
];

// Resolve a spoof id to ffmpeg args. Returns the args to APPEND to the command.
// Always called after `-map_metadata -1` and any custom `-metadata` flags so it
// overrides whatever else might be set.
export const encoderSpoofArgs = (id: string): string[] => {
  if (!id || id === "default") return [];
  if (id === "blank") {
    // bitexact tells ffmpeg's muxer not to stamp its own encoder string.
    // We also explicitly clear the encoder metadata in case anything else
    // along the chain (e.g. id3v2 muxer) tries to add one.
    return [
      "-fflags",
      "+bitexact",
      "-flags:a",
      "+bitexact",
      "-metadata",
      "encoder=",
    ];
  }
  const preset = ENCODER_PRESETS.find((p) => p.id === id);
  const value = preset?.value ?? id; // allow raw custom string as fallback
  // bitexact suppresses ffmpeg's auto-tag, then our explicit -metadata wins.
  return [
    "-fflags",
    "+bitexact",
    "-flags:a",
    "+bitexact",
    "-metadata",
    `encoder=${value}`,
  ];
};

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
