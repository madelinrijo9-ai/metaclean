export interface Artist {
  id: string;
  name: string;
  coverDataUrl?: string;
  album?: string;
  albumArtist?: string;
  year?: string;
  genre?: string;
  comment?: string;
}

const STORAGE_KEY = "metaclean.artists.v1";

export function loadArtists(): Artist[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a) => a && typeof a.id === "string" && typeof a.name === "string"
    );
  } catch {
    return [];
  }
}

export function saveArtists(artists: Artist[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(artists));
  } catch (err) {
    console.error("Failed to persist artists", err);
  }
}

/**
 * Best-effort extraction of a song title from a filename.
 * Strips extension, leading track numbers (01, 01., 01-, 01_, "Track 01 -"),
 * normalizes underscores/dots to spaces, collapses whitespace.
 * If the cleaned name contains " - " and we know the artist, drop the
 * leading "Artist - " prefix when it matches.
 */
export function deriveTitleFromFilename(filename: string, artistName?: string): string {
  const lastDot = filename.lastIndexOf(".");
  let base = lastDot > 0 ? filename.slice(0, lastDot) : filename;

  base = base.replace(/^track\s*[\s_.-]*\d+[\s_.-]+/i, "");
  base = base.replace(/^\d{1,3}[\s_.-]+/, "");
  base = base.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();

  if (artistName) {
    const an = artistName.trim().toLowerCase();
    const lower = base.toLowerCase();
    if (lower.startsWith(`${an} - `)) base = base.slice(an.length + 3).trim();
    else if (lower.startsWith(`${an} -`)) base = base.slice(an.length + 2).trim();
    else if (lower.startsWith(`${an} `)) {
      // leave as-is; might just be a song title that begins with the artist's name
    }
  }

  return base || filename;
}
