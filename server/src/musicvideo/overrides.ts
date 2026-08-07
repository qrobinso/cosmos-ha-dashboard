import type { DB } from '../store/db.js';

/**
 * A user's manual decision about which video plays for a song, overriding
 * automatic resolution entirely.
 *
 * `videoId === null` means BLOCKED — never play anything for this track. That
 * is deliberately distinct from having no row at all, which is what an
 * expired negative cache entry decays to: a block is permanent, an unmatched
 * track gets retried after 24h.
 */
export type MusicVideoOverride = {
  trackKey: string;
  videoId: string | null;
  /** Display names as HA reported them. The cache key is lowercased and
   *  decoration-stripped, so it is unfit for the admin list. */
  artist: string;
  title: string;
  createdAt: number;
};

export type MusicVideoOverrideRepo = {
  get(trackKey: string): MusicVideoOverride | null;
  /** Newest first. */
  list(): MusicVideoOverride[];
  put(o: { trackKey: string; videoId: string | null; artist: string; title: string }): void;
  /** True when a row was actually deleted. */
  remove(trackKey: string): boolean;
};

type Row = {
  track_key: string;
  video_id: string | null;
  artist: string;
  title: string;
  created_at: number;
};

function toOverride(r: Row): MusicVideoOverride {
  return {
    trackKey: r.track_key,
    videoId: r.video_id,
    artist: r.artist,
    title: r.title,
    createdAt: r.created_at,
  };
}

/**
 * Durable, never pruned. This is user intent, not a cache — unlike
 * `music_video_cache`, which `prune()` caps at MAX_CACHE_ROWS and evicts
 * oldest-first. Keeping them in separate tables is what stops routine
 * maintenance from silently deleting a pin set months ago.
 */
export function createMusicVideoOverrideRepo(
  db: DB,
  opts: { now?: () => number } = {},
): MusicVideoOverrideRepo {
  const now = opts.now ?? (() => Date.now());

  const sel = db.prepare('SELECT * FROM music_video_override WHERE track_key = ?');
  const selAll = db.prepare('SELECT * FROM music_video_override ORDER BY created_at DESC');
  const upsert = db.prepare(`
    INSERT INTO music_video_override (track_key, video_id, artist, title, created_at)
    VALUES (@trackKey, @videoId, @artist, @title, @at)
    ON CONFLICT(track_key) DO UPDATE SET
      video_id   = excluded.video_id,
      artist     = excluded.artist,
      title      = excluded.title,
      created_at = excluded.created_at
  `);
  const del = db.prepare('DELETE FROM music_video_override WHERE track_key = ?');

  return {
    get(trackKey) {
      const row = sel.get(trackKey) as Row | undefined;
      return row ? toOverride(row) : null;
    },
    list() {
      return (selAll.all() as Row[]).map(toOverride);
    },
    put(o) {
      upsert.run({ ...o, at: now() });
    },
    remove(trackKey) {
      return del.run(trackKey).changes > 0;
    },
  };
}
