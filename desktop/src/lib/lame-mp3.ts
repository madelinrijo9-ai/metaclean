// Pure-JS WAV → MP3 encoder using @breezystack/lamejs.
//
// We use this for all WAV → MP3 conversions because libmp3lame inside
// @ffmpeg/core 0.12.10 reliably traps with "table index is out of bounds" or
// "memory access out of bounds" partway through encoding Suno/Udio WAVs,
// regardless of how clean the input file is. lamejs is a battle-tested pure-JS
// LAME port that runs entirely on the main thread (no wasm) and produces
// bit-compatible MP3 output, so we sidestep ffmpeg's encoder for this path.

import lamejs from "@breezystack/lamejs";
import type { WavInfo } from "./wav";

const FRAME_SIZE = 1152; // LAME's standard MP3 frame sample count

/**
 * Encode a parsed WAV into an MP3 byte stream. Returns just the raw MP3
 * frames — wrap with ID3v2 tags separately if needed.
 */
export function encodeWavToMp3(
  info: WavInfo,
  bitrateKbps: number,
  onProgress?: (frac: number) => void
): Uint8Array {
  const channels = info.channels;
  const sampleRate = info.sampleRate;

  if (channels < 1 || channels > 2) {
    throw new Error(
      `lamejs only supports mono or stereo (got ${channels} channels)`
    );
  }

  const samples = pcmToInt16(info);
  const samplesPerChannel = Math.floor(samples.length / channels);

  const enc = new lamejs.Mp3Encoder(channels, sampleRate, bitrateKbps);
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  const pushChunk = (buf: Uint8Array) => {
    if (buf && buf.length > 0) {
      chunks.push(buf);
      totalLen += buf.length;
    }
  };

  if (channels === 1) {
    for (let i = 0; i < samplesPerChannel; i += FRAME_SIZE) {
      const end = Math.min(i + FRAME_SIZE, samplesPerChannel);
      const slice = samples.subarray(i, end);
      pushChunk(enc.encodeBuffer(slice));
      if (onProgress && (i & 0xffff) < FRAME_SIZE) {
        onProgress(i / samplesPerChannel);
      }
    }
  } else {
    // Stereo: de-interleave into L and R buffers per frame
    const left = new Int16Array(FRAME_SIZE);
    const right = new Int16Array(FRAME_SIZE);
    for (let i = 0; i < samplesPerChannel; i += FRAME_SIZE) {
      const len = Math.min(FRAME_SIZE, samplesPerChannel - i);
      for (let j = 0; j < len; j++) {
        left[j] = samples[(i + j) * 2];
        right[j] = samples[(i + j) * 2 + 1];
      }
      const lSlice = len < FRAME_SIZE ? left.subarray(0, len) : left;
      const rSlice = len < FRAME_SIZE ? right.subarray(0, len) : right;
      pushChunk(enc.encodeBuffer(lSlice, rSlice));
      if (onProgress && (i & 0xffff) < FRAME_SIZE) {
        onProgress(i / samplesPerChannel);
      }
    }
  }

  pushChunk(enc.flush());

  const out = new Uint8Array(totalLen);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  if (onProgress) onProgress(1);
  return out;
}

/**
 * Convert raw PCM bytes (in any of the standard WAV PCM formats) into a
 * tightly-packed Int16Array suitable for lamejs. Higher bit depths are
 * downconverted via arithmetic shift; floats are clamped to [-1,1] and scaled.
 */
function pcmToInt16(info: WavInfo): Int16Array {
  const { pcmBytes, bitDepth, formatTag } = info;
  const view = new DataView(
    pcmBytes.buffer,
    pcmBytes.byteOffset,
    pcmBytes.byteLength
  );

  if (formatTag === 1 && bitDepth === 16) {
    const sampleCount = pcmBytes.byteLength >>> 1;
    const out = new Int16Array(sampleCount);
    // Fast path when the underlying buffer is 2-byte aligned
    if ((pcmBytes.byteOffset & 1) === 0) {
      out.set(
        new Int16Array(
          pcmBytes.buffer,
          pcmBytes.byteOffset,
          sampleCount
        )
      );
    } else {
      for (let i = 0; i < sampleCount; i++) {
        out[i] = view.getInt16(i * 2, true);
      }
    }
    return out;
  }

  if (formatTag === 1 && bitDepth === 24) {
    const sampleCount = Math.floor(pcmBytes.byteLength / 3);
    const out = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      // Top two bytes of the 24-bit sample give us the 16-bit value.
      const mid = pcmBytes[i * 3 + 1];
      const hi = pcmBytes[i * 3 + 2];
      // Sign-extend
      out[i] = (((hi << 8) | mid) << 16) >> 16;
    }
    return out;
  }

  if (formatTag === 1 && bitDepth === 32) {
    const sampleCount = pcmBytes.byteLength >>> 2;
    const out = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      out[i] = view.getInt32(i * 4, true) >> 16;
    }
    return out;
  }

  if (formatTag === 1 && bitDepth === 8) {
    const out = new Int16Array(pcmBytes.length);
    for (let i = 0; i < pcmBytes.length; i++) {
      // u8 [0,255] → s16 [-32768,32512]
      out[i] = (pcmBytes[i] - 128) << 8;
    }
    return out;
  }

  if (formatTag === 3 && bitDepth === 32) {
    const sampleCount = pcmBytes.byteLength >>> 2;
    const out = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      let f = view.getFloat32(i * 4, true);
      if (f > 1) f = 1;
      else if (f < -1) f = -1;
      out[i] = (f * 32767) | 0;
    }
    return out;
  }

  if (formatTag === 3 && bitDepth === 64) {
    const sampleCount = pcmBytes.byteLength >>> 3;
    const out = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      let f = view.getFloat64(i * 8, true);
      if (f > 1) f = 1;
      else if (f < -1) f = -1;
      out[i] = (f * 32767) | 0;
    }
    return out;
  }

  throw new Error(
    `Unsupported PCM format for MP3 encode: formatTag=${formatTag}, bitDepth=${bitDepth}`
  );
}
