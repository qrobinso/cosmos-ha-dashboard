import type { MusicVideoCache } from './cache.js';
import { mvLog, mvWarn } from './log.js';
import { normalizeTrackKey } from './trackKey.js';
import type { VideoLookup } from './types.js';

export const DEFAULT_QUERY_SUFFIX = 'official music video';

/**
 * Ceiling on concurrent yt-dlp child processes. Rapid track-skipping would
 * otherwise spawn one 15-second process per skip — a real CPU/memory spike on
 * the Raspberry Pi many Home Assistant installs run on. Requests past the cap
 * are simply dropped (`{videoId: null}`); the next scene push retries, so no
 * queue is needed.
 */
export const MAX_CONCURRENT_LOOKUPS = 3;

/**
 * How long to stop attempting lookups after yt-dlp reports itself unrunnable.
 *
 * Long enough that a missing binary costs ~12 spawns an hour instead of
 * several a second, short enough that installing yt-dlp starts working within
 * a few minutes without a server restart.
 */
export const UNAVAILABLE_COOLDOWN_MS = 5 * 60 * 1000;

export type TrackRef = {
  artist?: string;
  title?: string;
  querySuffix?: string;
  /** HA's `media_duration` for the currently playing track — passed through
   * to `VideoLookup.search` as a scoring hint, the strongest discriminator
   * between near-identical search results. */
  durationSec?: number;
};

export type MusicVideoResolver = ((
  widgetId: string,
  track: TrackRef,
) => { videoId: string | null }) & {
  dispose(widgetId?: string): void;
  gc(liveWidgetIds: Iterable<string>): void;
  /** Test/diagnostic hook: number of lookups currently running. */
  inFlightCount(): number;
};

/**
 * Resolve a widget's current track to a YouTube videoId **without ever
 * blocking the caller**.
 *
 * `buildSceneState` is awaited on the scene-push path and a yt-dlp call takes
 * 2–5 seconds, so this function is deliberately synchronous: a cache hit
 * returns the id, and a miss returns `{videoId: null}` right away while the
 * lookup runs in the background. When that lookup lands, `onUpdate(widgetId)`
 * fires and the host marks the display dirty, producing a normal re-push with
 * the id filled in. The widget is simply hidden in between.
 *
 * Mirrors `createCanvasResolver`'s dispose/gc lifecycle.
 */
export function createMusicVideoResolver(
  lookup: VideoLookup,
  cache: MusicVideoCache,
  onUpdate: (widgetId: string) => void,
  opts: { now?: () => number } = {},
): MusicVideoResolver {
  const now = opts.now ?? (() => Date.now());

  /** trackKey → widgetIds awaiting that lookup. Dedupes concurrent searches. */
  const inFlight = new Map<string, Set<string>>();
  /** Widgets that have been disposed/gc'd and must not be notified. */
  const live = new Set<string>();
  /**
   * Epoch-ms until which we stop attempting lookups entirely.
   *
   * `unavailable` deliberately isn't negative-cached — the whole point is to
   * retry once yt-dlp appears. But "retry on the next scene push" is far more
   * often than it sounds: `media_position` ticks constantly, so an active
   * media player re-pushes several times a second, and a missing binary turned
   * into an unbounded spawn-and-log storm. Unavailability is a GLOBAL
   * condition (the binary is absent), not a per-track one, so one cooldown
   * covers every track.
   */
  let unavailableUntil = 0;

  function startLookup(
    trackKey: string,
    query: string,
    hint: { artist?: string; title?: string; durationSec?: number },
  ): void {
    const waiters = new Set<string>();
    inFlight.set(trackKey, waiters);

    mvLog(`lookup start key="${trackKey}" query="${query}"`);
    const startedAt = Date.now();

    void (async () => {
      let videoId: string | null = null;
      try {
        const found = await lookup.search(query, hint);
        const ms = Date.now() - startedAt;
        if (found.status === 'ok') {
          videoId = found.video.videoId;
          cache.putStream(found.video.videoId, found.video.streamUrl, found.video.duration);
          cache.putVideoId(trackKey, videoId);
          mvLog(
            `lookup ok    key="${trackKey}" videoId=${videoId} ` +
              `duration=${found.video.duration}s title="${found.video.title}" in ${ms}ms`,
          );
        } else if (found.status === 'none') {
          // The lookup RAN and found nothing — negative-cache it so we stop
          // respawning yt-dlp for an unmatchable track.
          cache.putVideoId(trackKey, null);
          mvLog(`lookup none  key="${trackKey}" negative-cached 24h in ${ms}ms`);
        } else {
          // 'unavailable' (yt-dlp missing / spawn refused) writes nothing to
          // the cache: the lookup never ran, so there is no result to
          // remember. Instead back off globally, so a missing binary costs one
          // spawn every UNAVAILABLE_COOLDOWN_MS rather than one per push.
          unavailableUntil = now() + UNAVAILABLE_COOLDOWN_MS;
          mvWarn(
            `lookup unavailable key="${trackKey}" — yt-dlp could not be run ` +
              `(missing binary or spawn refused). Pausing all lookups for ` +
              `${Math.round(UNAVAILABLE_COOLDOWN_MS / 1000)}s, then retrying automatically.`,
          );
        }
      } catch (err) {
        // A lookup that throws is a bug in the lookup, not a negative result:
        // don't poison the cache, just let the next push retry.
        videoId = null;
        mvWarn(`lookup threw key="${trackKey}" ${String(err)}`);
      } finally {
        inFlight.delete(trackKey);
      }

      if (!videoId) return;
      // A widget may have switched to a different track while this lookup was
      // in flight; it's still in `waiters` for the old trackKey, so it can get
      // one spurious onUpdate here. Harmless — the resulting re-push is
      // idempotent and will simply reflect whatever track it's on by then.
      for (const widgetId of waiters) {
        if (live.has(widgetId)) {
          mvLog(`notify widget=${widgetId} videoId=${videoId} (triggers scene re-push)`);
          onUpdate(widgetId);
        } else {
          mvLog(`notify skipped widget=${widgetId} — widget no longer live`);
        }
      }
    })();
  }

  const resolver = (widgetId: string, track: TrackRef) => {
    live.add(widgetId);

    const trackKey = normalizeTrackKey(track.artist, track.title);
    if (!trackKey) {
      mvLog(
        `skip widget=${widgetId} reason=no-track-key ` +
          `artist=${JSON.stringify(track.artist ?? null)} title=${JSON.stringify(track.title ?? null)}`,
      );
      return { videoId: null };
    }

    const cached = cache.getVideoId(trackKey);
    if (cached) {
      mvLog(
        cached.videoId
          ? `cache hit  key="${trackKey}" videoId=${cached.videoId}`
          : `cache miss key="${trackKey}" negative-cached, not retrying yet`,
      );
      return { videoId: cached.videoId };
    }

    const existing = inFlight.get(trackKey);
    if (existing) {
      existing.add(widgetId);
      mvLog(`join in-flight key="${trackKey}" widget=${widgetId}`);
      return { videoId: null };
    }

    // yt-dlp is known-unavailable; don't spawn again until the cooldown ends.
    // Flag-gated (not mvWarn) so a wall display with no yt-dlp installed stays
    // quiet after the one warning that explains it.
    if (now() < unavailableUntil) {
      mvLog(
        `skip widget=${widgetId} reason=unavailable-cooldown key="${trackKey}" ` +
          `(${Math.ceil((unavailableUntil - now()) / 1000)}s remaining)`,
      );
      return { videoId: null };
    }

    // Drop rather than queue when we're already at the process ceiling.
    if (inFlight.size >= MAX_CONCURRENT_LOOKUPS) {
      mvLog(
        `skip widget=${widgetId} reason=concurrency-cap key="${trackKey}" ` +
          `(${inFlight.size}/${MAX_CONCURRENT_LOOKUPS} in flight); next push retries`,
      );
      return { videoId: null };
    }

    const suffix = track.querySuffix?.trim() || DEFAULT_QUERY_SUFFIX;
    startLookup(trackKey, `${track.artist} ${track.title} ${suffix}`, {
      artist: track.artist,
      title: track.title,
      durationSec: track.durationSec,
    });
    inFlight.get(trackKey)?.add(widgetId);
    return { videoId: null };
  };

  return Object.assign(resolver, {
    dispose(widgetId?: string) {
      if (widgetId === undefined) live.clear();
      else live.delete(widgetId);
    },
    gc(liveWidgetIds: Iterable<string>) {
      const keep = new Set(liveWidgetIds);
      for (const id of live) if (!keep.has(id)) live.delete(id);
    },
    inFlightCount: () => inFlight.size,
  });
}
