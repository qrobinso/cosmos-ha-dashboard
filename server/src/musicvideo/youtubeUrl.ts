/**
 * Extract a YouTube video id from whatever a user pastes.
 *
 * "Paste a share link" is this feature's entire input surface, and share links
 * are messy — YouTube alone emits at least five URL shapes, and the share
 * button decorates them with `si`, `t`, `list`, and `feature` params. Getting
 * this wrong means the override silently pins nothing.
 */

/** Exactly the YouTube id alphabet, exactly 11 characters. */
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Hosts we accept. Matched as a whole label, never as a substring —
 *  `youtube.com.evil.example` must not pass. */
const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/** Path prefixes that carry the id as the next segment. */
const PATH_PREFIXES = ['shorts', 'embed', 'v', 'live'];

export function parseYouTubeId(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  // A bare id, pasted straight from someone reading it off a URL.
  if (ID_RE.test(raw)) return raw;

  const url = toUrl(raw);
  if (!url) return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  // youtu.be/<id> — the whole path is the id.
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    return validId(url.pathname.split('/')[1]);
  }

  // /watch?v=<id>, wherever `v` sits among the params.
  const v = url.searchParams.get('v');
  if (v) return validId(v);

  // /shorts/<id>, /embed/<id>, /v/<id>, /live/<id>
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && PATH_PREFIXES.includes(segments[0].toLowerCase())) {
    return validId(segments[1]);
  }

  return null;
}

/**
 * Parse permissively. Users paste protocol-relative (`//youtu.be/…`) and
 * bare-host (`youtu.be/…`) forms constantly; `new URL` rejects both, so
 * supply a scheme when one is missing rather than failing the paste.
 */
function toUrl(raw: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw.replace(/^\/\//, '')}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function validId(candidate: string | undefined): string | null {
  if (!candidate) return null;
  return ID_RE.test(candidate) ? candidate : null;
}
