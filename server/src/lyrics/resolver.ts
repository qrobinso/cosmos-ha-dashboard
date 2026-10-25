import { normalizeTrackKey } from '../musicvideo/trackKey.js';
import type { LyricsCache } from './cache.js';
import type { LyricsFetch, LyricsResult } from './lrclib.js';
import { markChorus, parseLrc, parsePlain, type LyricsLine } from './parse.js';

/** LRCLIB is fast, but rapid track-skipping shouldn't fan out unbounded requests.
 *  Past the cap a lookup is dropped; the next scene push retries it. */
export const MAX_CONCURRENT_LYRICS_LOOKUPS = 2;
/** Parsed-lines memo size: a playing track re-pushes often and shouldn't reparse. */
const PARSED_MEMO = 20;

export type LyricsTrack = { artist?: string; title?: string; durationSec?: number };
export type ResolvedLyrics = { lines: LyricsLine[] | null; synced: boolean; trackKey: string | null };

export type LyricsResolver = ((widgetId: string, track: LyricsTrack) => ResolvedLyrics) & {
  dispose(widgetId?: string): void;
  gc(liveWidgetIds: Iterable<string>): void;
};

function toLines(r: LyricsResult): { lines: LyricsLine[] | null; synced: boolean } {
  if (r.instrumental) return { lines: null, synced: false };
  const timed = r.synced ? parseLrc(r.synced) : [];
  if (timed.length) return { lines: markChorus(timed), synced: true };
  const plain = r.plain ? parsePlain(r.plain) : [];
  return plain.length ? { lines: markChorus(plain), synced: false } : { lines: null, synced: false };
}

/**
 * Resolve a widget's current track to lyrics **without blocking the scene push**
 * — same contract as `createMusicVideoResolver`: a cache hit returns lines, a
 * miss returns null at once and fires `onUpdate(widgetId)` when the fetch lands.
 */
export function createLyricsResolver(
  fetcher: LyricsFetch,
  cache: LyricsCache,
  onUpdate: (widgetId: string) => void,
): LyricsResolver {
  const inFlight = new Map<string, Set<string>>();
  const live = new Set<string>();
  const parsed = new Map<string, { lines: LyricsLine[] | null; synced: boolean }>();

  function start(key: string, durationSec: number | undefined) {
    const waiters = new Set<string>();
    inFlight.set(key, waiters);
    const [artist, title] = key.split('|');
    fetcher
      .get({ artist, title, durationSec })
      .then(
        (result) => {
          cache.put(key, result);
          parsed.delete(key);
          for (const id of waiters) if (live.has(id)) onUpdate(id);
        },
        (err) => console.error(`[lyrics] lookup failed for "${key}": ${(err as Error).message}`),
      )
      .finally(() => inFlight.delete(key));
  }

  const resolve = ((widgetId: string, track: LyricsTrack): ResolvedLyrics => {
    live.add(widgetId);
    const trackKey = normalizeTrackKey(track.artist, track.title);
    if (!trackKey) return { lines: null, synced: false, trackKey: null };

    const memo = parsed.get(trackKey);
    if (memo) return { ...memo, trackKey };

    const cached = cache.get(trackKey);
    if (cached) {
      const out = cached.result ? toLines(cached.result) : { lines: null, synced: false };
      parsed.set(trackKey, out);
      if (parsed.size > PARSED_MEMO) parsed.delete(parsed.keys().next().value!);
      return { ...out, trackKey };
    }

    const waiting = inFlight.get(trackKey);
    if (waiting) waiting.add(widgetId);
    else if (inFlight.size < MAX_CONCURRENT_LYRICS_LOOKUPS) {
      start(trackKey, track.durationSec);
      inFlight.get(trackKey)!.add(widgetId);
    }
    return { lines: null, synced: false, trackKey };
  }) as LyricsResolver;

  resolve.dispose = (widgetId) => {
    if (widgetId === undefined) live.clear();
    else live.delete(widgetId);
  };
  resolve.gc = (liveIds) => {
    const keep = new Set(liveIds);
    for (const id of [...live]) if (!keep.has(id)) live.delete(id);
  };
  return resolve;
}
