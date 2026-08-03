import { spawn } from 'node:child_process';
import type { ResolvedVideo, VideoLookup, VideoSearchResult } from './types.js';

export const YTDLP_TIMEOUT_MS = 15_000;

/**
 * Progressive 360p MP4 with muxed audio. Deliberately NOT `best` — the
 * higher-resolution YouTube formats are DASH-only fragmented streams that
 * will not play in a bare <video> tag, and format 18 supports the byte-range
 * seeking the position-sync feature depends on.
 */
const FORMAT = '18';

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

  return {
    search: (query) => invoke(`ytsearch1:${query}`),
    streamUrlFor: async (videoId) => {
      const r = await invoke(`https://www.youtube.com/watch?v=${videoId}`);
      return r.status === 'ok' ? r.video.streamUrl : null;
    },
  };
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
