/**
 * Pure candidate scoring for the yt-dlp two-phase lookup. No I/O, no clock,
 * no logging — that purity is what makes this fast and deterministic to
 * test against hand-captured fixtures.
 *
 * The point values are load-bearing. They were tuned against real yt-dlp
 * output for two songs where the correct video is NOT the first search hit,
 * and both fixtures live in `server/test/musicvideo.score.test.ts` as the
 * regression guard. Retune only with those tests in front of you: the weights
 * trade off against each other, and fixing one song by feel has already
 * broken the other once.
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
  /** HA's `media_duration` for the currently playing track. Used to reject
   * unrelated content (medleys, compilations); deliberately NOT strong enough
   * to outrank an explicit "official video" title. See `durationScore`. */
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

/**
 * Duration's job is to REJECT UNRELATED CONTENT — medleys, compilations,
 * full-album uploads, hour-long mixes — not to choose between edits of the
 * same song. It is therefore a modest, asymmetric signal.
 *
 * Asymmetric because the two directions mean different things:
 *
 *  - **Much longer than the track** is genuinely suspicious. Nothing legitimate
 *    is three minutes longer than the song; that's a medley or a compilation.
 *  - **Shorter than the track** is completely normal. Official videos are very
 *    often single edits — Bowie's official "Heroes" video is 3:29 against a
 *    6:11 album cut. Punishing that would reject the correct answer.
 *
 * An earlier version made duration the dominant signal (±50), which fixed one
 * real case and broke another: it picked a length-matching official LIVE video
 * over the official studio video, because the live cut happened to match the
 * album runtime. Duration is now weak enough that `official video` (+30) beats
 * a live performance whose length merely coincides.
 *
 * Both real fixtures in the tests are the regression guard: Solange must pick
 * the studio "Weary" (not the Fallon medley), and Bowie must pick the studio
 * "Heroes" video (not the live one). Retuning must keep both.
 *
 * The widget loops and wraps a short video (`position % videoDuration`), so a
 * shorter correct video costs a visible restart mid-song — accepted as the
 * lesser evil against playing the wrong performance entirely.
 */
function durationScore(candidateSec: number | null, ctxSec: number | undefined): number {
  if (candidateSec == null || ctxSec == null) return 0;

  const diff = candidateSec - ctxSec;
  const magnitude = Math.abs(diff);

  // Close enough either way: a real, if weak, positive signal.
  if (magnitude <= 5) return 20;
  if (magnitude <= 15) return 12;

  if (diff > 0) {
    // Longer than the track — the suspicious direction.
    // Softened deliberately: official videos routinely run long on intros and
    // outros — Tame Impala's "The Less I Know The Better" video is 5:43
    // against a 3:36 album track — so this must not be heavy enough to bury a
    // candidate that already says "official video".
    if (diff > 120) return -30; // compilation, mix, or full album
    if (diff > 45) return -20; // medley, or a different (longer) arrangement
    return 0;
  }

  // Shorter than the track — usually just a single edit, so barely penalized.
  if (candidateSec < ctxSec * 0.5) return -20; // a clip or preview, not the song
  if (magnitude > 45) return -5;
  return 0;
}

function channelScore(channel: string, artist: string | undefined, verified: boolean): number {
  let score = 0;
  if (artist && artist.length >= 3 && containsEither(channel, artist)) score += 25;
  if (verified) score += 15;
  return score;
}

/**
 * Is this the artist's own channel?
 *
 * Normalization makes VEVO and "…music" suffixes fall out for free:
 * `TaylorSwiftVEVO` -> `taylorswiftvevo` contains `taylorswift`, and
 * `solangeknowlesmusic` contains `solange`.
 *
 * Note that `channel_is_verified` is deliberately NOT sufficient on its own.
 * Large lyric-video and re-upload channels are verified too — `7clouds` is
 * verified and publishes "(Lyrics)" videos — so verification says "this is a
 * real channel", not "this is the artist".
 */
export function isArtistChannel(channel: string, artist: string | undefined): boolean {
  if (!artist || artist.length < 3) return false;
  return containsEither(channel, artist);
}

/**
 * Strip diacritics so one ASCII pattern matches every accented spelling.
 *
 * Without this, matching "vídeo" or "officielle" means either duplicating
 * every pattern per accent or relying on `\b`, which is defined by the ASCII
 * `\w` — so in "vídeo" JavaScript sees a word boundary between "v" and "í"
 * and `/\bvídeo\b/` silently fails. Folding first sidesteps all of it.
 */
function fold(title: string): string {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Patterns are matched against the DIACRITIC-FOLDED title, so write them in
 * plain ASCII: "letra" catches "Letra", "vivo" catches "vívo".
 *
 * The non-English entries are load-bearing rather than decorative. The
 * official/video check below accepts several languages, and without matching
 * disqualifiers a Spanish lyric video on the artist's own channel would sail
 * through — trading one wrong answer for another.
 */
const TITLE_PENALTIES: Array<{ pattern: RegExp; points: number }> = [
  { pattern: /karaoke/i, points: -40 },
  { pattern: /reaction/i, points: -40 },
  {
    // en vivo / ao vivo / en directo / dal vivo are the Romance-language
    // equivalents of "live". Matched as phrases, not on a bare "vivo", which
    // turns up inside artist and album names.
    pattern: /\blive\b|live at|live from|en vivo|ao vivo|en directo|dal vivo/i,
    points: -35,
  },
  { pattern: /\bcover\b/i, points: -30 },
  { pattern: /full album/i, points: -30 },
  // An explicit "(Audio)" label is the artist telling us this is not a video.
  { pattern: /\baudio\b/i, points: -35 },
  { pattern: /lyrics?|\bletras?\b|\bparoles\b|\btesto\b|\bliedtext\b/i, points: -25 },
  { pattern: /remix/i, points: -25 },
  { pattern: /sped up|slowed/i, points: -25 },
  { pattern: /instrumental/i, points: -20 },
];

/**
 * "Official" and "video" both present, in any order and not necessarily
 * adjacent — `Official Video`, `Official Music Video`, `[Official] … Video`
 * all count. Matched loosely on purpose, since orderings vary widely.
 *
 * Both accept the common non-English spellings. This is not politeness: the
 * English-only version silently discarded EVERY Spanish-language official
 * video, because artists label them "Video Oficial". That was found in a real
 * library, where Bad Bunny's own videos on his own channel were being
 * rejected — a systematic blind spot across whole catalogues, not an edge case.
 *
 * Matched against the folded title, so no accent variants are needed here.
 */
const OFFICIAL_WORD =
  /\b(?:official|oficial|officiel(?:le)?s?|offiziell(?:es|e|er)?|ufficiale)\b/i;

/**
 * `video` is matched as a SUBSTRING rather than a whole word, because the
 * compounds are where the other languages live: "Musikvideo", "Videoclip",
 * "videoclipe". `clip` / `clipe` are whole-word, since French and Portuguese
 * label a music video that way with no "video" in sight ("Clip Officiel").
 *
 * Loose matching is safe here only because it is one of THREE requirements —
 * the title must also claim to be official, and the upload must be on the
 * artist's own channel.
 */
const VIDEO_WORD = /video|\bclips?\b|\bclipes?\b/i;

export function hasOfficialVideoWords(title: string): boolean {
  const folded = fold(title);
  return OFFICIAL_WORD.test(folded) && VIDEO_WORD.test(folded);
}

function titleScore(title: string, ctxTitle: string | undefined): number {
  let score = 0;
  // Constant across every candidate that survives the hard requirement in
  // `ytdlp.ts`, so it no longer discriminates between them — kept because
  // MIN_SCORE is calibrated against a scale that includes it, and because it
  // would start ranking again if that requirement were relaxed.
  if (hasOfficialVideoWords(title)) score += 30;

  if (ctxTitle && ctxTitle.length >= 3) {
    if (!containsEither(title, ctxTitle)) score -= 20;
  }

  const folded = fold(title);
  for (const { pattern, points } of TITLE_PENALTIES) {
    if (pattern.test(folded)) score += points;
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
 * Minimum score a candidate must reach to be played at all.
 *
 * Below this the widget stays hidden rather than showing something wrong —
 * an empty slot on a wall reads better than a lyric video or the wrong song.
 *
 * Calibrated against the two real fixtures in the tests. Observed scores
 * either side of the line:
 *
 *   +70  Bowie   — "Heroes" (Official Video), studio cut          -> plays
 *   +65  Solange — "Weary" (official channel, exact duration)     -> plays
 *   +52  Bowie   — "Heroes" (Live) [Official Video]               -> plays, but loses
 *   +25  "Cranes in the Sky" — right artist, wrong song           -> hidden
 *   +22  "weary - solange | visual exploration", unofficial       -> hidden
 *    +0  "SOLANGE - WEARY (OFFICIAL LYRICS)"                      -> hidden
 *   -20  "Rise/Weary Medley (Live from The Tonight Show)"         -> hidden
 *   -67  "Weary (REMIX) | By Matty The Chef"                      -> hidden
 *
 * Roughly "the artist's own verified channel with nothing disqualifying", or
 * a decent duration match plus one strong corroborating signal.
 */
export const MIN_SCORE = 40;

/** A human-readable breakdown of how a candidate scored, for the "why is my
 * video not playing" log line. Pure — the caller does the logging. */
export function explainCandidate(
  c: Candidate,
  ctx: ScoreContext,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  const dur = durationScore(c.durationSec, ctx.durationSec);
  if (c.durationSec == null || ctx.durationSec == null) {
    reasons.push('no duration to compare');
  } else {
    const delta = Math.abs(c.durationSec - ctx.durationSec);
    reasons.push(`duration ${c.durationSec}s vs track ${ctx.durationSec}s (${delta}s off) ${fmt(dur)}`);
  }

  if (ctx.artist && ctx.artist.length >= 3) {
    reasons.push(
      containsEither(c.channel, ctx.artist)
        ? `channel "${c.channel}" matches artist ${fmt(25)}`
        : `channel "${c.channel}" does not match artist "${ctx.artist}" ${fmt(0)}`,
    );
  }
  if (c.verified) reasons.push(`verified channel ${fmt(15)}`);

  if (hasOfficialVideoWords(c.title)) reasons.push(`title has "official" + "video" ${fmt(30)}`);
  if (ctx.title && ctx.title.length >= 3 && !containsEither(c.title, ctx.title)) {
    reasons.push(`title does not contain "${ctx.title}" ${fmt(-20)}`);
  }
  const foldedTitle = fold(c.title);
  for (const { pattern, points } of TITLE_PENALTIES) {
    if (pattern.test(foldedTitle)) {
      reasons.push(`title matches /${pattern.source}/ ${fmt(points)}`);
    }
  }

  return { score: scoreCandidate(c, ctx), reasons };
}

function fmt(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
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
