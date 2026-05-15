// Minimal ID3v2.3 tag writer. Produces just the header bytes so they can be
// prepended to a raw MP3 frame stream.
//
// Spec reference: https://id3.org/id3v2.3.0
//
// We support the handful of frames that matter for clean audio metadata:
//   TIT2 = title       TPE1 = artist        TALB = album
//   TPE2 = album-artist TYER = year          TRCK = track
//   TCON = genre       COMM = comment       TSSE = software/encoder
//   APIC = attached picture (cover art)
//
// Text frames use UTF-16 with BOM (encoding byte 0x01) so non-ASCII metadata
// (Spanish, Japanese, etc.) round-trips correctly. APIC mime/desc use latin1
// per spec.

export interface Id3Tags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: string;
  genre?: string;
  track?: string;
  comment?: string;
  encoder?: string;
}

export interface Id3Cover {
  mimeType: string; // e.g. "image/jpeg" or "image/png"
  data: Uint8Array;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

// Synchsafe integer: 4 bytes, each holding 7 bits of the value (high bit clear).
const synchsafe = (n: number): Uint8Array =>
  new Uint8Array([
    (n >>> 21) & 0x7f,
    (n >>> 14) & 0x7f,
    (n >>> 7) & 0x7f,
    n & 0x7f,
  ]);

// Plain big-endian 32-bit (used for v2.3 frame sizes — NOT synchsafe in v2.3).
const beU32 = (n: number): Uint8Array =>
  new Uint8Array([
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ]);

const ascii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

// UTF-16LE with BOM, null-terminated. Caller prepends the encoding byte (0x01).
const utf16leBomTerm = (s: string): Uint8Array => {
  const out = new Uint8Array(2 + s.length * 2 + 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + i * 2] = c & 0xff;
    out[2 + i * 2 + 1] = (c >>> 8) & 0xff;
  }
  // last 2 bytes are the null terminator (already 0)
  return out;
};

const frameHeader = (id4: string, bodyLen: number): Uint8Array => {
  const hdr = new Uint8Array(10);
  for (let i = 0; i < 4; i++) hdr[i] = id4.charCodeAt(i);
  hdr.set(beU32(bodyLen), 4);
  // bytes 8-9 are flags: 0
  return hdr;
};

const textFrame = (id4: string, value: string): Uint8Array => {
  const text = utf16leBomTerm(value);
  const body = new Uint8Array(1 + text.length);
  body[0] = 0x01; // UTF-16 with BOM
  body.set(text, 1);
  return concat(frameHeader(id4, body.length), body);
};

const commentFrame = (value: string, lang = "eng"): Uint8Array => {
  // COMM body: encoding(1) + language(3) + short-desc + null + actual-text
  const desc = utf16leBomTerm(""); // empty short description (BOM + null)
  const text = utf16leBomTerm(value);
  const body = new Uint8Array(1 + 3 + desc.length + text.length);
  let p = 0;
  body[p++] = 0x01;
  body.set(ascii(lang.padEnd(3, " ").slice(0, 3)), p);
  p += 3;
  body.set(desc, p);
  p += desc.length;
  body.set(text, p);
  return concat(frameHeader("COMM", body.length), body);
};

const apicFrame = (cover: Id3Cover): Uint8Array => {
  // APIC body: encoding(1) + mime + 0x00 + picType(1) + desc + 0x00 + image
  const mime = ascii(cover.mimeType);
  const body = new Uint8Array(1 + mime.length + 1 + 1 + 1 + cover.data.length);
  let p = 0;
  body[p++] = 0x00; // encoding latin1 (for the description; mime is always latin1)
  body.set(mime, p);
  p += mime.length;
  body[p++] = 0x00; // mime null terminator
  body[p++] = 0x03; // picture type: front cover
  body[p++] = 0x00; // empty description, null terminated
  body.set(cover.data, p);
  return concat(frameHeader("APIC", body.length), body);
};

/**
 * Build a complete ID3v2.3 tag (header + frames). Returns a fresh
 * Uint8Array ready to prepend to MP3 frame data.
 */
export function buildId3v2(tags: Id3Tags, cover?: Id3Cover): Uint8Array {
  const frames: Uint8Array[] = [];
  if (tags.title) frames.push(textFrame("TIT2", tags.title));
  if (tags.artist) frames.push(textFrame("TPE1", tags.artist));
  if (tags.album) frames.push(textFrame("TALB", tags.album));
  if (tags.albumArtist) frames.push(textFrame("TPE2", tags.albumArtist));
  if (tags.year) frames.push(textFrame("TYER", tags.year));
  if (tags.genre) frames.push(textFrame("TCON", tags.genre));
  if (tags.track) frames.push(textFrame("TRCK", tags.track));
  if (tags.comment) frames.push(commentFrame(tags.comment));
  if (tags.encoder) frames.push(textFrame("TSSE", tags.encoder));
  if (cover) frames.push(apicFrame(cover));

  if (frames.length === 0) {
    return new Uint8Array(0);
  }

  const body = concat(...frames);
  const header = new Uint8Array(10);
  header[0] = 0x49; // 'I'
  header[1] = 0x44; // 'D'
  header[2] = 0x33; // '3'
  header[3] = 0x03; // version 2.3.0
  header[4] = 0x00;
  header[5] = 0x00; // no flags
  header.set(synchsafe(body.length), 6);
  return concat(header, body);
}

/** Decode a `data:image/...;base64,...` URL into bytes + mime. */
export function dataUrlToCover(dataUrl: string): Id3Cover | null {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  const mimeType = m[1];
  try {
    const binary = atob(m[2]);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
    return { mimeType, data };
  } catch {
    return null;
  }
}
