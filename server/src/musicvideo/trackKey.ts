/**
 * Collapse an (artist, title) pair into a stable cache key.
 *
 * Streaming services decorate the same song a dozen ways — "(feat. X)",
 * "- Remastered 2009", "(Deluxe Edition)" — and each variant would otherwise
 * cost its own yt-dlp search. Stripping the decoration means the whole family
 * shares one cached videoId.
 */

/** `feat.` / `ft.` / `featuring`, bare or parenthesised, to end of segment. */
const FEAT = /\s*[([]?\s*\b(?:feat\.?|ft\.?|featuring)\b[^)\]]*[)\]]?\s*$/i;

/** Remaster / edition / version decoration, parenthesised or after a dash. */
const VERSION =
  /\s*(?:[-–—]\s*|[([])\s*(?:\d{4}\s+)?(?:re-?master(?:ed)?|remix|deluxe|mono|stereo|radio edit|single version|album version|expanded|anniversary)[^)\]]*[)\]]?\s*$/i;

function clean(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  // Loop: a title can carry both decorations, e.g. "Song (feat. X) - Remastered".
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(FEAT, '').replace(VERSION, '').trim();
    if (s === before) break;
  }
  return s.toLowerCase();
}

/**
 * Returns `"<artist>|<title>"`, or null when either half is missing, blank,
 * or reduced to nothing by stripping.
 */
export function normalizeTrackKey(
  artist: string | undefined,
  title: string | undefined,
): string | null {
  if (!artist || !title) return null;
  const a = clean(artist);
  const t = clean(title);
  if (!a || !t) return null;
  return `${a}|${t}`;
}
