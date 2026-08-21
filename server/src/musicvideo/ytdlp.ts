import { spawn } from 'node:child_process';
import type { ResolvedVideo, SearchHint, VideoLookup, VideoSearchResult } from './types.js';
import type { Candidate } from './score.js';
import {
  pickBest,
  scoreCandidate,
  explainCandidate,
  hasOfficialVideoWords,
  isArtistChannel,
  MIN_SCORE,
} from './score.js';
import { mvLog, mvWarn } from './log.js';

export const YTDLP_TIMEOUT_MS = 15_000;

/**
 * Downloads move real bytes, so they get their own, far longer budget than a
 * metadata lookup. A 360p video is a few MB; 3 minutes covers a slow line
 * without letting a wedged process linger forever.
 */
export const YTDLP_DOWNLOAD_TIMEOUT_MS = 180_000;

/**
 * The media format used everywhere: resolving a stream URL to proxy, and
 * downloading a local copy. One constant, because both paths must serve
 * byte-identical content — the download is simply the cached form of the
 * stream.
 *
 * **Video-only, on purpose.** YouTube has been retiring progressive (muxed)
 * formats: for many videos format 18 is no longer offered at all, and where an
 * older yt-dlp still reports it, the URL returns 403. That was the cause of the
 * "upstream returned 403" churn. Only adaptive video-only and audio-only
 * streams remain.
 *
 * Dropping audio costs nothing here, because the widget is ALWAYS muted —
 * sound comes from the Home Assistant speaker, never the kiosk. So we take the
 * video track alone: no muxing, therefore still no ffmpeg in the image, and a
 * smaller file. yt-dlp writes a standard MP4 with a moov atom, and its URL
 * serves ranged requests, so both `<video src>` and the proxy work unchanged
 * (verified end to end in a real browser).
 *
 * Capped at 480p: this is wall ambience, often behind other widgets at reduced
 * opacity, so 1080p would spend disk and decode budget on detail nobody sees.
 * `18` stays in the chain for videos that still offer it, and a bare MP4 is the
 * last resort, so an unusual video degrades rather than fails outright.
 */
const FORMAT = [
  'bestvideo[ext=mp4][vcodec^=avc1][height<=480]',
  'bestvideo[ext=mp4][height<=480]',
  '18',
  'bestvideo[ext=mp4]',
].join('/');


/**
 * `spawnFailed` distinguishes "the binary could not be started at all"
 * (ENOENT, EACCES) from a clean non-zero exit or a timeout. Only the former
 * means the lookup never ran.
 */
export type SpawnResult = { ok: boolean; stdout: string; spawnFailed?: boolean };

export type SpawnFn = (args: string[], timeoutMs: number) => Promise<SpawnResult>;

export type YtDlpOptions = {
  binary?: string;
  timeoutMs?: number;
  /** Separate budget for downloads, which move bytes rather than JSON. */
  downloadTimeoutMs?: number;
  /** Injected by tests so yt-dlp never actually runs. */
  spawnFn?: SpawnFn;
};

/**
 * Run the binary, collecting stdout. Resolves `{ok:false}` on non-zero exit,
 * spawn error, or timeout — and on timeout it KILLS the child, otherwise a
 * wedged yt-dlp lingers until process exit.
 */
function defaultSpawn(binary: string): SpawnFn {
  return (args, timeoutMs) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean, stdout: string, spawnFailed = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok, stdout, spawnFailed });
      };

      const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout.on('data', (c: Buffer) => {
        stdout += c.toString('utf8');
      });
      child.on('error', () => finish(false, '', true));
      child.on('close', (code) => finish(code === 0, stdout));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(false, '');
      }, timeoutMs);
    });
}

/** Pull the first JSON object out of `yt-dlp -j` output. Never throws. */
function parseFirstJson(stdout: string): Record<string, unknown> | null {
  const line = stdout.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parse every non-empty line of `yt-dlp --flat-playlist -j` output into JSON
 * objects. Malformed lines are skipped rather than failing the whole batch —
 * one bad candidate shouldn't sink the search. Never throws. */
function parseAllJson(stdout: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') out.push(parsed as Record<string, unknown>);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/** Flat-playlist JSON -> scoring Candidate. Flat mode does not provide
 * categories/uploader_id/artist/track/album — verified against the real
 * binary — so this only reads fields flat mode actually emits. */
function toCandidate(json: Record<string, unknown>): Candidate | null {
  const videoId = typeof json.id === 'string' ? json.id : '';
  if (!videoId) return null;
  return {
    videoId,
    title: typeof json.title === 'string' ? json.title : '',
    channel:
      typeof json.channel === 'string'
        ? json.channel
        : typeof json.uploader === 'string'
          ? json.uploader
          : '',
    verified: json.channel_is_verified === true,
    durationSec: typeof json.duration === 'number' && Number.isFinite(json.duration)
      ? json.duration
      : null,
    viewCount: typeof json.view_count === 'number' && Number.isFinite(json.view_count)
      ? json.view_count
      : null,
  };
}

function toResolved(json: Record<string, unknown>): ResolvedVideo | null {
  const videoId = typeof json.id === 'string' ? json.id : '';
  const streamUrl = typeof json.url === 'string' ? json.url : '';
  if (!videoId || !streamUrl) return null;
  return {
    videoId,
    streamUrl,
    duration: typeof json.duration === 'number' && Number.isFinite(json.duration)
      ? json.duration
      : 0,
    title: typeof json.title === 'string' ? json.title : '',
  };
}

/** "Artist — Title" for log lines, or a placeholder when HA gave us neither. */
function describeTrack(hint: SearchHint | undefined): string {
  const artist = hint?.artist?.trim();
  const title = hint?.title?.trim();
  if (!artist && !title) return 'unknown track';
  return `${artist ?? '?'} — ${title ?? '?'}`;
}

/**
 * The only file in the codebase that knows yt-dlp exists.
 *
 * NOTE: yt-dlp is against YouTube's Terms of Service and its extractors break
 * when YouTube changes. This was a deliberate, accepted tradeoff — see the
 * design spec. Everything else talks to the `VideoLookup` interface, so
 * swapping in a YouTube Data API client means writing one new file.
 */
export function createYtDlpLookup(opts: YtDlpOptions = {}): VideoLookup {
  const binary = opts.binary ?? 'yt-dlp';
  const timeoutMs = opts.timeoutMs ?? YTDLP_TIMEOUT_MS;
  const run = opts.spawnFn ?? defaultSpawn(binary);

  async function invoke(target: string): Promise<VideoSearchResult> {
    try {
      const { ok, stdout, spawnFailed } = await run(
        ['-f', FORMAT, '-j', '--no-playlist', '--no-warnings', target],
        timeoutMs,
      );
      if (spawnFailed) return { status: 'unavailable' };
      if (!ok) return { status: 'none' };
      const json = parseFirstJson(stdout);
      const video = json ? toResolved(json) : null;
      return video ? { status: 'ok', video } : { status: 'none' };
    } catch {
      // The spawn seam itself rejected — we never got as far as running.
      return { status: 'unavailable' };
    }
  }

  /**
   * Two-phase search: phase 1 is a fast, metadata-only flat-playlist listing
   * of several candidates; phase 2 resolves a real stream URL for the WINNER
   * only, chosen by `pickBest` (see ./score.ts). Resolving formats for every
   * candidate would be far slower and mostly wasted.
   */
  async function search(query: string, hint?: SearchHint): Promise<VideoSearchResult> {
    let phase1: { ok: boolean; stdout: string; spawnFailed?: boolean };
    try {
      phase1 = await run(
        ['--flat-playlist', '-j', '--no-warnings', `ytsearch5:${query}`],
        timeoutMs,
      );
    } catch {
      return { status: 'unavailable' };
    }
    if (phase1.spawnFailed) return { status: 'unavailable' };
    if (!phase1.ok) {
      mvWarn(
        `search failed for "${describeTrack(hint)}": yt-dlp exited non-zero on the ` +
          `candidate search. Nothing will play. A broken extractor is the usual ` +
          `cause — try \`yt-dlp -U\`.`,
      );
      return {
        status: 'none',
        reason: 'The YouTube search itself failed — yt-dlp may need updating.',
      };
    }

    const candidates = parseAllJson(phase1.stdout)
      .map(toCandidate)
      .filter((c): c is Candidate => c !== null);
    if (candidates.length === 0) {
      mvWarn(
        `no search results for "${describeTrack(hint)}" (query: "${query}"). ` +
          `Nothing will play; the widget stays hidden.`,
      );
      return { status: 'none', reason: 'YouTube returned no results for this track.' };
    }

    // TWO HARD REQUIREMENTS, both required — a candidate is excluded before
    // ranking rather than merely penalized:
    //
    //   1. The title contains both "official" and "video".
    //   2. The channel is the artist's own (VEVO and "…music" variants
    //      included; see isArtistChannel).
    //
    // Requirement 2 exists because requirement 1 alone is trivially gamed:
    // anyone can type "Official Music Video" into a title, and once wording
    // became mandatory, re-uploaders who did exactly that were the only
    // survivors for songs whose genuine video lacks the phrase. Observed live:
    // Kendrick Lamar's "HUMBLE." search returned the real video (no wording,
    // filtered) beside an unverified Korean re-upload titled "(Official Music
    // Video)", which then won; and Taylor Swift's "Blank Space" picked a
    // re-upload from "CISUM -THE BEST MUSIC" over her verified channel's copy.
    //
    // This is a deliberate accuracy-over-coverage trade with a known cost:
    // genuine official videos frequently carry no such wording — "Kendrick
    // Lamar - HUMBLE.", "Radiohead - Karma Police", "Taylor Swift - Blank
    // Space" — so those songs display nothing at all. Relaxing requirement 1
    // means restoring the Art Track rule in score.ts (see the note there).
    // The channel requirement needs an artist to compare against. Without one
    // it cannot be evaluated at all, so it is skipped rather than failing every
    // candidate — same reasoning as the confidence gate below. In production
    // the resolver only calls us once `normalizeTrackKey` produced an artist,
    // so this only affects direct/degenerate callers.
    const canCheckChannel = !!hint?.artist;
    const eligible = candidates.filter(
      (c) =>
        hasOfficialVideoWords(c.title) &&
        (!canCheckChannel || isArtistChannel(c.channel, hint?.artist)),
    );
    if (eligible.length === 0) {
      mvWarn(
        `no official video for "${describeTrack(hint)}": none of the ` +
          `${candidates.length} search results are on the artist's own channel ` +
          `AND titled with both "official" and "video", so nothing will play.\n` +
          candidates
            .map((c) => {
              const why = !hasOfficialVideoWords(c.title)
                ? 'title lacks "official" + "video"'
                : 'not the artist\'s channel';
              return `      · rejected "${c.title}" (${c.channel}) — ${why}`;
            })
            .join('\n'),
      );
      return {
        status: 'none',
        reason:
          `None of the ${candidates.length} search results qualified. ` +
          `A video must be on the artist's own channel AND have both ` +
          `"official" and "video" in its title. Closest: ` +
          candidates
            .slice(0, 3)
            .map((c) => `"${c.title}" (${c.channel})`)
            .join('; '),
      };
    }

    const winner = pickBest(eligible, {
      artist: hint?.artist,
      title: hint?.title,
      durationSec: hint?.durationSec,
    });
    if (!winner) return { status: 'none' };

    logCandidates(query, eligible, winner.videoId, hint);

    // Confidence gate: if even the best candidate is weak, play nothing rather
    // than something wrong. A hidden widget reads better on a wall than a
    // lyric video or the wrong song, and 'none' gets negative-cached so we
    // stop re-searching a track YouTube simply doesn't have a good video for.
    const ctx = {
      artist: hint?.artist,
      title: hint?.title,
      durationSec: hint?.durationSec,
    };
    // The gate needs artist AND title to mean anything — without them most
    // signals are unavailable and every candidate would score low, so we'd
    // reject everything rather than judging it. In practice the resolver only
    // calls us once `normalizeTrackKey` has produced both, so this guard is
    // for direct/degenerate callers.
    const canAssess = !!ctx.artist && !!ctx.title;
    const { score, reasons } = explainCandidate(winner, ctx);
    if (canAssess && score < MIN_SCORE) {
      mvWarn(
        `no confident match for "${describeTrack(hint)}": ` +
          `best candidate scored ${score}, below the ${MIN_SCORE} threshold, so nothing will play.\n` +
          `    rejected: "${winner.title}" (${winner.videoId})\n` +
          reasons.map((r) => `      · ${r}`).join('\n') +
          `\n    Widget stays hidden. Adjust the widget's "Search suffix" if this track needs a better query.`,
      );
      return {
        status: 'none',
        reason:
          `Best candidate "${winner.title}" (${winner.channel}) scored ${score}, ` +
          `below the ${MIN_SCORE} needed to play. ${reasons.join('; ')}`,
      };
    }

    const resolved = await invoke(`https://www.youtube.com/watch?v=${winner.videoId}`);
    if (resolved.status !== 'ok') {
      mvWarn(
        `picked "${winner.title}" (${winner.videoId}, score ${score}) for ` +
          `"${describeTrack(hint)}" but could not resolve a playable stream ` +
          `(${resolved.status}). Nothing will play.`,
      );
    }
    return resolved;
  }

  return {
    search,
    streamUrlFor: async (videoId) => {
      const r = await invoke(`https://www.youtube.com/watch?v=${videoId}`);
      return r.status === 'ok' ? r.video.streamUrl : null;
    },
    // Same single call as streamUrlFor, but keeping the metadata it discards.
    probe: (videoId) => invoke(`https://www.youtube.com/watch?v=${videoId}`),

    download: async (videoId, destPath) => {
      try {
        const { ok, spawnFailed } = await run(
          [
            '-f', FORMAT,
            // Write straight to the final name. Without this yt-dlp leaves a
            // .part file behind on failure, which the store would later see
            // as a missing file anyway — but this keeps the cache dir clean.
            '--no-part',
            '--no-playlist', '--no-warnings',
            '-o', destPath,
            `https://www.youtube.com/watch?v=${videoId}`,
          ],
          opts.downloadTimeoutMs ?? YTDLP_DOWNLOAD_TIMEOUT_MS,
        );
        return ok && !spawnFailed;
      } catch {
        return false;
      }
    },
  };
}

/** One audit-friendly line per candidate with its score, marking the winner.
 * Flag-gated via `mvLog` itself — silent unless `LOG_MUSICVIDEO=1`. */
function logCandidates(
  query: string,
  candidates: Candidate[],
  winnerId: string,
  hint: SearchHint | undefined,
): void {
  const ctx = { artist: hint?.artist, title: hint?.title, durationSec: hint?.durationSec };
  mvLog(`candidates query="${query}" track=${ctx.durationSec ?? '?'}s`);
  for (const c of candidates) {
    const marker = c.videoId === winnerId ? '*' : ' ';
    const score = scoreCandidate(c, ctx);
    const sign = score >= 0 ? '+' : '';
    mvLog(
      `  ${sign}${score}${marker} ${c.videoId} ${c.durationSec ?? '?'}s ` +
        `ch=${c.channel}${c.verified ? '✓' : ''} "${c.title}"`,
    );
  }
}

/**
 * One-shot `yt-dlp --version`. Resolves true when the binary is runnable.
 * Never throws and never blocks the caller — `index.ts` fires it at startup so
 * a missing binary is logged ONCE rather than silently per lookup.
 */
export async function probeYtDlpAvailable(opts: YtDlpOptions = {}): Promise<boolean> {
  const binary = opts.binary ?? 'yt-dlp';
  const run = opts.spawnFn ?? defaultSpawn(binary);
  try {
    const { ok, spawnFailed } = await run(['--version'], opts.timeoutMs ?? 5_000);
    return ok && !spawnFailed;
  } catch {
    return false;
  }
}
