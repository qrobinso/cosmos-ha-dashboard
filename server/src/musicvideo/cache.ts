import type { DB } from '../store/db.js';

/** A negative result is retried after a day — a video may get uploaded later. */
export const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * YouTube expires stream URLs at roughly 6h. We treat 4h as stale so a URL is
 * never handed to a display close to its true expiry — the 2h margin covers a
 * long song started just before the cutoff.
 */
export const STREAM_TTL_MS = 4 * 60 * 60 * 1000;

/** `null` videoId with `miss: true` means "looked, found nothing, don't retry yet". */
export type CachedLookup = { videoId: string | null; miss: boolean };
export type CachedStream = { streamUrl: string; duration: number };

/**
 * Hard ceiling on remembered `trackKey -> videoId` rows.
 *
 * Generous: a household would have to play ~5000 distinct songs before the
 * oldest is forgotten, and forgetting one costs a single yt-dlp lookup. The
 * point is that the table is bounded at all — it is written on every newly
 * played track and was never pruned, so it grew for the life of the DB.
 */
export const MAX_CACHE_ROWS = 5000;

export type MusicVideoCache = {
  /** null = nothing usable cached, go look it up. */
  getVideoId(trackKey: string): CachedLookup | null;
  /** Pass null to record a negative result. */
  putVideoId(trackKey: string, videoId: string | null): void;
  /** null = absent or stale; the caller should re-derive. */
  getStream(videoId: string): CachedStream | null;
  putStream(videoId: string, streamUrl: string, duration: number): void;
  invalidateStream(videoId: string): void;
  /** Drop expired negatives and stale stream URLs, then cap the lookup table.
   *  Returns how many rows went, for logging. Cheap enough to run hourly. */
  prune(): { negatives: number; streams: number; overflow: number };
};

export function createMusicVideoCache(
  db: DB,
  opts: { now?: () => number } = {},
): MusicVideoCache {
  const now = opts.now ?? (() => Date.now());

  const selLookup = db.prepare(
    'SELECT video_id, miss, resolved_at FROM music_video_cache WHERE track_key = ?',
  );
  const upsertLookup = db.prepare(`
    INSERT INTO music_video_cache (track_key, video_id, miss, resolved_at)
    VALUES (@key, @videoId, @miss, @at)
    ON CONFLICT(track_key) DO UPDATE SET
      video_id = excluded.video_id,
      miss = excluded.miss,
      resolved_at = excluded.resolved_at
  `);
  const selStream = db.prepare(
    'SELECT stream_url, duration, resolved_at FROM music_video_stream WHERE video_id = ?',
  );
  const upsertStream = db.prepare(`
    INSERT INTO music_video_stream (video_id, stream_url, duration, resolved_at)
    VALUES (@videoId, @url, @duration, @at)
    ON CONFLICT(video_id) DO UPDATE SET
      stream_url = excluded.stream_url,
      duration = excluded.duration,
      resolved_at = excluded.resolved_at
  `);
  const delStream = db.prepare('DELETE FROM music_video_stream WHERE video_id = ?');

  return {
    getVideoId(trackKey) {
      const row = selLookup.get(trackKey) as
        | { video_id: string | null; miss: number; resolved_at: number }
        | undefined;
      if (!row) return null;
      if (row.miss) {
        // Negative results age out; positive ones never do.
        if (now() - row.resolved_at > NEGATIVE_TTL_MS) return null;
        return { videoId: null, miss: true };
      }
      if (!row.video_id) return null;
      return { videoId: row.video_id, miss: false };
    },

    putVideoId(trackKey, videoId) {
      upsertLookup.run({
        key: trackKey,
        videoId,
        miss: videoId ? 0 : 1,
        at: now(),
      });
    },

    getStream(videoId) {
      const row = selStream.get(videoId) as
        | { stream_url: string; duration: number; resolved_at: number }
        | undefined;
      if (!row) return null;
      if (now() - row.resolved_at > STREAM_TTL_MS) return null;
      return { streamUrl: row.stream_url, duration: row.duration };
    },

    putStream(videoId, streamUrl, duration) {
      upsertStream.run({ videoId, url: streamUrl, duration, at: now() });
    },

    invalidateStream(videoId) {
      delStream.run(videoId);
    },

    prune() {
      const t = now();

      // Expired negatives are pure dead weight: getVideoId already ignores
      // them, so they only ever occupy space.
      const negatives = db
        .prepare('DELETE FROM music_video_cache WHERE miss = 1 AND resolved_at < ?')
        .run(t - NEGATIVE_TTL_MS).changes;

      // Stale stream URLs are unusable — googlevideo has expired them — and
      // the proxy re-derives on demand anyway.
      const streams = db
        .prepare('DELETE FROM music_video_stream WHERE resolved_at < ?')
        .run(t - STREAM_TTL_MS).changes;

      // Cap the durable table, oldest first. Positive rows never expire by
      // design (a videoId stays correct forever), so this is the only bound.
      const overflow = db
        .prepare(
          `DELETE FROM music_video_cache WHERE track_key IN (
             SELECT track_key FROM music_video_cache
             ORDER BY resolved_at DESC
             LIMIT -1 OFFSET ?
           )`,
        )
        .run(MAX_CACHE_ROWS).changes;

      return { negatives, streams, overflow };
    },
  };
}
