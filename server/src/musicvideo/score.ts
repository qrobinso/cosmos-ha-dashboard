/**
 * Pure candidate scoring for the yt-dlp two-phase lookup. No I/O, no clock,
 * no logging — that purity is what makes this fast and deterministic to
 * test against a hand-captured fixture. See
 * `docs/superpowers/sdd/2026-08-02-music-video-widget/task-9-brief.md` for
 * the design rationale and the exact point values, which are load-bearing:
 * they were tuned against real yt-dlp output where the correct video is NOT
 * the first search hit.
 */

/** A phase-1 (`--flat-playlist`) search result. Flat mode does not expose
 * `categories`, `uploader_id`, `artist`, `track`, or `album` — verified
 * against the real binary — so scoring must not depend on those fields. */
export type Candidate = {
  videoId: string;
  title: string;
  channel: string;
  verified: boolean;
  durationSec: number | null;
  viewCount: number | null;
};

export type ScoreContext = {
  artist?: string;
  title?: string;
  /** HA's `media_duration` for the currently playing track. The strongest signal. */
  durationSec?: number;
};

/** Lowercase, strip everything that isn't a-z0-9. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Either normalized string contains the other. Guards against a very short
 * `needle` (< 3 chars post-normalization) producing false-positive matches. */
function containsEither(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length < 3 || nb.length < 3) return false;
  return na.includes(nb) || nb.includes(na);
}

function durationScore(candidateSec: number | null, ctxSec: number | undefined): number {
  if (candidateSec == null || ctxSec == null) return 0;
  const delta = Math.abs(candidateSec - ctxSec);
  if (delta <= 2) return 50;
  if (delta <= 5) return 35;
  if (delta <= 15) return 10;
  if (delta <= 45) return 0;
  return -40;
}

function channelScore(channel: string, artist: string | undefined, verified: boolean): number {
  let score = 0;
  if (artist && artist.length >= 3 && containsEither(channel, artist)) score += 25;
  if (verified) score += 15;
  return score;
}

const TITLE_PENALTIES: Array<{ pattern: RegExp; points: number }> = [
  { pattern: /karaoke/i, points: -40 },
  { pattern: /reaction/i, points: -40 },
  { pattern: /\blive\b|live at|live from/i, points: -30 },
  { pattern: /\bcover\b/i, points: -30 },
  { pattern: /full album/i, points: -30 },
  { pattern: /lyrics?/i, points: -25 },
  { pattern: /remix/i, points: -25 },
  { pattern: /sped up|slowed/i, points: -25 },
  { pattern: /instrumental/i, points: -20 },
  { pattern: /\baudio\b/i, points: -10 },
];

const OFFICIAL_VIDEO_PATTERN = /official\s+(music\s+)?video/i;

function titleScore(title: string, ctxTitle: string | undefined): number {
  let score = 0;
  if (OFFICIAL_VIDEO_PATTERN.test(title)) score += 15;

  if (ctxTitle && ctxTitle.length >= 3) {
    if (!containsEither(title, ctxTitle)) score -= 20;
  }

  for (const { pattern, points } of TITLE_PENALTIES) {
    if (pattern.test(title)) score += points;
  }

  return score;
}

function popularityScore(viewCount: number | null): number {
  if (viewCount == null) return 0;
  return Math.min(5, Math.floor(Math.log10(Math.max(1, viewCount))));
}

export function scoreCandidate(c: Candidate, ctx: ScoreContext): number {
  return (
    durationScore(c.durationSec, ctx.durationSec) +
    channelScore(c.channel, ctx.artist, c.verified) +
    titleScore(c.title, ctx.title) +
    popularityScore(c.viewCount)
  );
}

/**
 * Highest scorer wins; ties broken by original search order. Returns `null`
 * only for an empty candidate list — never because everything scored badly.
 * A mediocre match still beats a hidden widget.
 */
export function pickBest(candidates: Candidate[], ctx: ScoreContext): Candidate | null {
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestScore = scoreCandidate(best, ctx);
  for (let i = 1; i < candidates.length; i++) {
    const score = scoreCandidate(candidates[i], ctx);
    if (score > bestScore) {
      best = candidates[i];
      bestScore = score;
    }
  }
  return best;
}
