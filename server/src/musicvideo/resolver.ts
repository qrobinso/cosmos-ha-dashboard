import type { MusicVideoCache } from './cache.js';
import { normalizeTrackKey } from './trackKey.js';
import type { VideoLookup } from './types.js';

export const DEFAULT_QUERY_SUFFIX = 'official music video';

export type TrackRef = {
  artist?: string;
  title?: string;
  querySuffix?: string;
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
): MusicVideoResolver {
  /** trackKey → widgetIds awaiting that lookup. Dedupes concurrent searches. */
  const inFlight = new Map<string, Set<string>>();
  /** Widgets that have been disposed/gc'd and must not be notified. */
  const live = new Set<string>();

  function startLookup(trackKey: string, query: string): void {
    const waiters = new Set<string>();
    inFlight.set(trackKey, waiters);

    void (async () => {
      let videoId: string | null = null;
      try {
        const found = await lookup.search(query);
        if (found) {
          videoId = found.videoId;
          cache.putStream(found.videoId, found.streamUrl, found.duration);
        }
        // Cache the outcome either way — a null here is a negative result,
        // which stops us respawning yt-dlp for an unmatchable track.
        cache.putVideoId(trackKey, videoId);
      } catch {
        // A lookup that throws is a bug in the lookup, not a negative result:
        // don't poison the cache, just let the next push retry.
        videoId = null;
      } finally {
        inFlight.delete(trackKey);
      }

      if (!videoId) return;
      for (const widgetId of waiters) {
        if (live.has(widgetId)) onUpdate(widgetId);
      }
    })();
  }

  const resolver = (widgetId: string, track: TrackRef) => {
    live.add(widgetId);

    const trackKey = normalizeTrackKey(track.artist, track.title);
    if (!trackKey) return { videoId: null };

    const cached = cache.getVideoId(trackKey);
    if (cached) return { videoId: cached.videoId };

    const existing = inFlight.get(trackKey);
    if (existing) {
      existing.add(widgetId);
      return { videoId: null };
    }

    const suffix = track.querySuffix?.trim() || DEFAULT_QUERY_SUFFIX;
    startLookup(trackKey, `${track.artist} ${track.title} ${suffix}`);
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
