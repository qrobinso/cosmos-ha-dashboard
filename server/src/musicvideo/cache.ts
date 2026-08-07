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
export type CachedLookup = {
  videoId: string | null;
  miss: boolean;
  /** On a miss, why nothing matched — surfaced in the admin page so
   *  "Nothing found" is actionable rather than a dead end. */
  reason?: string | null;
};
export type CachedStream = { streamUrl: string; duration: number };

/** One row of the admin History list. */
export type CacheHistoryEntry = {
  trackKey: string;
  videoId: string | null;
  miss: boolean;
  /** Null for rows written before migration v12 — render the trackKey instead. */
  artist: string | null;
  title: string | null;
  /** On a miss, why nothing matched. Null on hits and pre-v13 rows. */
  reason: string | null;
  resolvedAt: number;
};

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
  /** Pass null to record a negative result. `names` are stored for the admin
   *  History list only — resolution itself keys entirely off `trackKey`. */
  putVideoId(
    trackKey: string,
    videoId: string | null,
    names?: { artist?: string; title?: string; reason?: string },
  ): void;
  /** null = absent or stale; the caller should re-derive. */
  getStream(videoId: string): CachedStream | null;
  putStream(videoId: string, streamUrl: string, duration: number): void;
  /** Duration only, ignoring the URL's TTL — a re-derive that only has a
   *  fresh URL (no duration of its own) can carry a previously known value
   *  forward instead of clobbering it to 0. 0 if nothing was ever recorded. */
  peekStreamDuration(videoId: string): number;
  invalidateStream(videoId: string): void;
  /** Drop expired negatives and stale stream URLs, then cap the lookup table.
   *  Returns how many rows went, for logging. Cheap enough to run hourly. */
  prune(): { negatives: number; streams: number; overflow: number };
  /** Most recent resolutions, newest first. Drives the admin History list. */
  listRecent(limit: number, offset?: number): CacheHistoryEntry[];
  /** How many rows a `search` (or, with no query, `listRecent`) can reach.
   *  The admin list pages through all of them, so it needs the total. */
  count(query?: string): number;
  /**
   * Substring search across EVERY remembered song, newest first.
   *
   * Deliberately unbounded by the Recent window: the songs a user most wants
   * to fix are the ones that scrolled out of it. Matches artist, title, and
   * the track key — the last so that rows written before migration v12 (which
   * have no display names) are still findable.
   *
   * A blank query returns nothing rather than everything, so an empty search
   * box can never be mistaken for "no songs".
   */
  search(query: string, limit: number, offset?: number): CacheHistoryEntry[];
};

/**
 * Escape a user's search string for use inside a LIKE pattern.
 *
 * Without this, `%` matches every song and `_` matches any single character —
 * so searching for a song called "100% Real" would return the whole library.
 */
function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Shared by `listRecent` and `search` — both select the same columns. */
type HistoryRow = {
  track_key: string;
  video_id: string | null;
  miss: number;
  resolved_at: number;
  artist: string | null;
  title: string | null;
  reason: string | null;
};

function toHistoryEntry(r: HistoryRow): CacheHistoryEntry {
  return {
    trackKey: r.track_key,
    videoId: r.video_id,
    miss: !!r.miss,
    artist: r.artist,
    title: r.title,
    reason: r.reason,
    resolvedAt: r.resolved_at,
  };
}

export function createMusicVideoCache(
  db: DB,
  opts: { now?: () => number } = {},
): MusicVideoCache {
  const now = opts.now ?? (() => Date.now());

  const selLookup = db.prepare(
    'SELECT video_id, miss, resolved_at, reason FROM music_video_cache WHERE track_key = ?',
  );
  const upsertLookup = db.prepare(`
    INSERT INTO music_video_cache (track_key, video_id, miss, resolved_at, artist, title, reason)
    VALUES (@key, @videoId, @miss, @at, @artist, @title, @reason)
    ON CONFLICT(track_key) DO UPDATE SET
      video_id    = excluded.video_id,
      miss        = excluded.miss,
      resolved_at = excluded.resolved_at,
      reason      = excluded.reason,
      -- Keep names we already have when a re-resolve supplies none.
      artist      = COALESCE(excluded.artist, music_video_cache.artist),
      title       = COALESCE(excluded.title, music_video_cache.title)
  `);
  const selRecent = db.prepare(
    `SELECT track_key, video_id, miss, resolved_at, artist, title, reason
       FROM music_video_cache ORDER BY resolved_at DESC LIMIT @limit OFFSET @offset`,
  );
  const selCountAll = db.prepare('SELECT COUNT(*) AS n FROM music_video_cache');
  const selCountSearch = db.prepare(
    `SELECT COUNT(*) AS n FROM music_video_cache
      WHERE track_key LIKE @pattern ESCAPE '\\' COLLATE NOCASE
         OR artist    LIKE @pattern ESCAPE '\\' COLLATE NOCASE
         OR title     LIKE @pattern ESCAPE '\\' COLLATE NOCASE`,
  );
  // COLLATE NOCASE gives case-insensitive matching. Note SQLite's built-in
  // collations only fold ASCII, so a query for "JAY" will not match "jaÿ" —
  // acceptable here, and fixing it would mean linking ICU.
  const selSearch = db.prepare(
    `SELECT track_key, video_id, miss, resolved_at, artist, title, reason
       FROM music_video_cache
      WHERE track_key LIKE @pattern ESCAPE '\\' COLLATE NOCASE
         OR artist    LIKE @pattern ESCAPE '\\' COLLATE NOCASE
         OR title     LIKE @pattern ESCAPE '\\' COLLATE NOCASE
      ORDER BY resolved_at DESC LIMIT @limit OFFSET @offset`,
  );

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
        | { video_id: string | null; miss: number; resolved_at: number; reason: string | null }
        | undefined;
      if (!row) return null;
      if (row.miss) {
        // Negative results age out; positive ones never do.
        if (now() - row.resolved_at > NEGATIVE_TTL_MS) return null;
        return { videoId: null, miss: true, reason: row.reason };
      }
      if (!row.video_id) return null;
      return { videoId: row.video_id, miss: false };
    },

    putVideoId(trackKey, videoId, names) {
      upsertLookup.run({
        key: trackKey,
        videoId,
        miss: videoId ? 0 : 1,
        at: now(),
        artist: names?.artist ?? null,
        title: names?.title ?? null,
        // A hit has nothing to explain; clear any reason left from a prior miss.
        reason: videoId ? null : (names?.reason ?? null),
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

    peekStreamDuration(videoId) {
      const row = selStream.get(videoId) as { duration: number } | undefined;
      return row?.duration ?? 0;
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

    count(query) {
      const trimmed = (query ?? '').trim();
      if (!trimmed) return (selCountAll.get() as { n: number }).n;
      const row = selCountSearch.get({ pattern: `%${escapeLike(trimmed)}%` }) as { n: number };
      return row.n;
    },

    search(query, limit, offset = 0) {
      const trimmed = (query ?? '').trim();
      // An empty box means "no search", not "match everything" — returning the
      // whole library here would read as a result set the user asked for.
      if (!trimmed) return [];
      const rows = selSearch.all({
        pattern: `%${escapeLike(trimmed)}%`,
        limit,
        offset,
      }) as HistoryRow[];
      return rows.map(toHistoryEntry);
    },

    listRecent(limit, offset = 0) {
      return (selRecent.all({ limit, offset }) as HistoryRow[]).map(toHistoryEntry);
    },
  };
}
