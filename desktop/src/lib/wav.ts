// Pure-JS WAV header parser. Extracts the raw PCM payload and format info
// without invoking ffmpeg's WAV demuxer, which crashes with
// "memory access out of bounds" on Suno/Udio WAVs that embed malformed
// LIST/INFO chunks (bogus chunk-size fields trip libavformat's allocator).
//
// We walk the RIFF chunks looking only for "fmt " and "data". If a chunk's
// declared size points past EOF, we fall back to a byte-scan for "data" so
// even broken files yield clean PCM samples.

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  /** WAVE format tag: 1=PCM int, 3=IEEE float, 0xFFFE=extensible */
  formatTag: number;
  /** Raw PCM bytes (no RIFF header), ready to feed ffmpeg via `-f <pcm>`. */
  pcmBytes: Uint8Array;
}

const ascii = (u8: Uint8Array, start: number, len: number): string => {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(u8[start + i]);
  return s;
};

const findChunkByScan = (
  u8: Uint8Array,
  view: DataView,
  fourCC: string
): { start: number; size: number } | null => {
  const a = fourCC.charCodeAt(0);
  const b = fourCC.charCodeAt(1);
  const c = fourCC.charCodeAt(2);
  const d = fourCC.charCodeAt(3);
  // Start scan at 12 (after RIFF/size/WAVE)
  for (let i = 12; i + 8 <= u8.byteLength; i++) {
    if (u8[i] === a && u8[i + 1] === b && u8[i + 2] === c && u8[i + 3] === d) {
      const sz = view.getUint32(i + 4, true);
      return { start: i + 8, size: sz };
    }
  }
  return null;
};

export async function parseWavToPcm(file: File | Blob): Promise<WavInfo> {
  const buf = await file.arrayBuffer();
  if (buf.byteLength < 44) {
    throw new Error("WAV file too small to contain a header");
  }
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  const riff = ascii(u8, 0, 4);
  if (riff !== "RIFF" && riff !== "RF64" && riff !== "BW64") {
    throw new Error(`Not a WAV file (header was "${riff}")`);
  }
  const wave = ascii(u8, 8, 4);
  if (wave !== "WAVE") {
    throw new Error(`Not a WAVE file (form was "${wave}")`);
  }

  let fmt: {
    sampleRate: number;
    channels: number;
    bitDepth: number;
    formatTag: number;
  } | null = null;
  let data: Uint8Array | null = null;

  let pos = 12;
  let walkedOk = true;

  while (pos + 8 <= u8.byteLength) {
    const chunkId = ascii(u8, pos, 4);
    const chunkSize = view.getUint32(pos + 4, true);
    const chunkStart = pos + 8;
    const chunkEnd = chunkStart + chunkSize;

    // Bail out of the structured walk if the chunk would overflow the buffer.
    // We'll fall back to byte-scanning below.
    if (chunkSize > u8.byteLength || chunkEnd > u8.byteLength + 8) {
      walkedOk = false;
      break;
    }

    if (chunkId === "fmt " && chunkSize >= 16) {
      const formatTag = view.getUint16(chunkStart + 0, true);
      const channels = view.getUint16(chunkStart + 2, true);
      const sampleRate = view.getUint32(chunkStart + 4, true);
      const bitDepth = view.getUint16(chunkStart + 14, true);
      // For WAVE_FORMAT_EXTENSIBLE the real format is in the SubFormat GUID
      // at offset chunkStart + 24 (first 2 bytes are the format tag).
      let realTag = formatTag;
      if (formatTag === 0xfffe && chunkSize >= 40) {
        realTag = view.getUint16(chunkStart + 24, true);
      }
      fmt = { formatTag: realTag, channels, sampleRate, bitDepth };
    } else if (chunkId === "data") {
      const safeEnd = Math.min(chunkEnd, u8.byteLength);
      data = u8.subarray(chunkStart, safeEnd);
      break; // we have everything we need
    }

    // RIFF chunks are 2-byte aligned
    pos = chunkEnd + (chunkSize & 1);
  }

  // Byte-scan fallback for any chunk we couldn't get via the structured walk.
  // This handles Suno/Udio files where a junk chunk has a corrupt size field.
  if (!fmt) {
    const found = findChunkByScan(u8, view, "fmt ");
    if (found && found.size >= 16 && found.start + 16 <= u8.byteLength) {
      const formatTag = view.getUint16(found.start + 0, true);
      const channels = view.getUint16(found.start + 2, true);
      const sampleRate = view.getUint32(found.start + 4, true);
      const bitDepth = view.getUint16(found.start + 14, true);
      let realTag = formatTag;
      if (
        formatTag === 0xfffe &&
        found.size >= 40 &&
        found.start + 26 <= u8.byteLength
      ) {
        realTag = view.getUint16(found.start + 24, true);
      }
      fmt = { formatTag: realTag, channels, sampleRate, bitDepth };
    }
  }
  if (!data) {
    const found = findChunkByScan(u8, view, "data");
    if (found) {
      const start = found.start;
      const declaredEnd = start + found.size;
      // If the declared data size is bogus (very common in broken files),
      // just use everything from the data marker to EOF.
      const end =
        found.size > 0 && declaredEnd <= u8.byteLength
          ? declaredEnd
          : u8.byteLength;
      data = u8.subarray(start, end);
    }
  }

  if (!walkedOk && (!fmt || !data)) {
    // intentionally non-fatal — diagnostics only
    console.warn(
      "[wav] structured chunk walk bailed; used byte-scan fallback",
      { fmtFound: !!fmt, dataFound: !!data, fileSize: u8.byteLength }
    );
  }

  if (!fmt) throw new Error("WAV is missing a 'fmt ' chunk");
  if (!data || data.byteLength === 0) {
    throw new Error("WAV is missing a usable 'data' chunk");
  }

  // Trim trailing partial frame so ffmpeg doesn't read past valid samples.
  const bytesPerFrame = (fmt.channels * fmt.bitDepth) / 8;
  if (bytesPerFrame > 0 && data.byteLength % bytesPerFrame !== 0) {
    const usable = data.byteLength - (data.byteLength % bytesPerFrame);
    data = data.subarray(0, usable);
  }

  return { ...fmt, pcmBytes: data };
}

/**
 * Map a WAV (formatTag, bitDepth) to the ffmpeg `-f` flag for headerless
 * raw PCM input. Returns null if unsupported. (Kept for diagnostics; the
 * primary path is now wrapPcmAsWav, which feeds ffmpeg a clean RIFF file
 * instead of using the raw-PCM demuxer.)
 */
export function pcmFormatFlag(
  formatTag: number,
  bitDepth: number
): string | null {
  if (formatTag === 1) {
    if (bitDepth === 8) return "u8";
    if (bitDepth === 16) return "s16le";
    if (bitDepth === 24) return "s24le";
    if (bitDepth === 32) return "s32le";
    return null;
  }
  if (formatTag === 3) {
    if (bitDepth === 32) return "f32le";
    if (bitDepth === 64) return "f64le";
    return null;
  }
  return null;
}

/**
 * Wrap raw PCM samples in a freshly-built minimal RIFF/WAVE container —
 * just `RIFF`, `fmt `, and `data` chunks, no LIST/INFO/junk. Lets us hand
 * ffmpeg's well-tested WAV demuxer a known-clean file regardless of how
 * mangled the input was. Returns a Uint8Array that owns its own ArrayBuffer
 * (safe to transfer to the worker without disturbing the source PCM bytes).
 */
export function wrapPcmAsWav(info: WavInfo): Uint8Array {
  const { sampleRate, channels, bitDepth, formatTag, pcmBytes } = info;

  if (channels < 1 || channels > 8) {
    throw new Error(`Unsupported channel count: ${channels}`);
  }
  if (![8, 16, 24, 32, 64].includes(bitDepth)) {
    throw new Error(`Unsupported bit depth: ${bitDepth}`);
  }
  // Normalize formatTag: WAVE_FORMAT_PCM (1) for ints, WAVE_FORMAT_FLOAT (3) for floats.
  const wfTag = formatTag === 3 ? 3 : 1;

  const blockAlign = (channels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const fmtChunkSize = 16;
  const dataChunkSize = pcmBytes.byteLength;
  // RIFF chunk size = 4 ("WAVE") + (8 + fmtChunkSize) + (8 + dataChunkSize)
  const riffChunkSize = 4 + (8 + fmtChunkSize) + (8 + dataChunkSize);

  const out = new Uint8Array(8 + riffChunkSize);
  const view = new DataView(out.buffer);
  let p = 0;

  const writeAscii = (s: string) => {
    for (let i = 0; i < s.length; i++) out[p + i] = s.charCodeAt(i);
    p += s.length;
  };

  // RIFF header
  writeAscii("RIFF");
  view.setUint32(p, riffChunkSize, true); p += 4;
  writeAscii("WAVE");

  // fmt chunk
  writeAscii("fmt ");
  view.setUint32(p, fmtChunkSize, true); p += 4;
  view.setUint16(p, wfTag, true); p += 2;
  view.setUint16(p, channels, true); p += 2;
  view.setUint32(p, sampleRate, true); p += 4;
  view.setUint32(p, byteRate, true); p += 4;
  view.setUint16(p, blockAlign, true); p += 2;
  view.setUint16(p, bitDepth, true); p += 2;

  // data chunk
  writeAscii("data");
  view.setUint32(p, dataChunkSize, true); p += 4;
  out.set(pcmBytes, p);

  return out;
}
