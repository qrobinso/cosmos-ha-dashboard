import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../store/db.js';

/**
 * Locally downloaded video files.
 *
 * Distinct from `music_video_stream`, which caches a short-lived googlevideo
 * URL. That URL expires (and YouTube can revoke it early, which is what the
 * "upstream returned 403" log line is), so streaming through the proxy means
 * reaching YouTube again and again for the same bytes. Once a file is here,
 * playback never leaves the house.
 *
 * Eviction is least-played-first, oldest-of-those-first, so the songs on
 * repeat survive and a track played once a year is the first to go.
 */
export type VideoFileStore = {
  /** Where this video's file lives. Null if the id is not a safe filename. */
  pathFor(videoId: string): string | null;
  /** True only when a row AND the file itself exist — disk is the authority. */
  has(videoId: string): boolean;
  /** Register a completed download. */
  record(videoId: string, bytes: number): void;
  /** Count a play. Drives eviction order; safe to call for unknown ids. */
  recordPlay(videoId: string): void;
  playCount(videoId: string): number;
  totalBytes(): number;
  stats(): { fileCount: number; totalBytes: number };
  /** Delete least-played (then oldest) until total <= maxBytes.
   *  Returns the ids removed. A cap of 0 clears everything. */
  evict(maxBytes: number): string[];
  remove(videoId: string): void;
};

/**
 * YouTube ids are `[A-Za-z0-9_-]`, and this value arrives from a URL param.
 * Anything else is refused rather than sanitised, so a traversal attempt can
 * never resolve to a path outside the cache directory.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

export function createVideoFileStore(
  db: DB,
  opts: { dir: string; now?: () => number },
): VideoFileStore {
  const now = opts.now ?? (() => Date.now());
  const dir = opts.dir;
  mkdirSync(dir, { recursive: true });

  const selOne = db.prepare('SELECT * FROM music_video_file WHERE video_id = ?');
  const upsert = db.prepare(`
    INSERT INTO music_video_file (video_id, bytes, play_count, last_played_at, downloaded_at)
    VALUES (@id, @bytes, 0, NULL, @at)
    ON CONFLICT(video_id) DO UPDATE SET
      bytes = excluded.bytes,
      downloaded_at = excluded.downloaded_at
  `);
  const bumpPlay = db.prepare(
    'UPDATE music_video_file SET play_count = play_count + 1, last_played_at = ? WHERE video_id = ?',
  );
  const selTotal = db.prepare(
    'SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS total FROM music_video_file',
  );
  // Eviction order, straight from the requirement: least played first, and
  // among equally-played files the one untouched longest. COALESCE lets a
  // never-played file fall back to when it was downloaded.
  const selVictims = db.prepare(`
    SELECT video_id, bytes FROM music_video_file
    ORDER BY play_count ASC, COALESCE(last_played_at, downloaded_at) ASC
  `);
  const del = db.prepare('DELETE FROM music_video_file WHERE video_id = ?');

  function pathFor(videoId: string): string | null {
    if (!SAFE_ID.test(videoId)) return null;
    return join(dir, `${videoId}.mp4`);
  }

  function deleteFile(videoId: string): void {
    const p = pathFor(videoId);
    if (p) rmSync(p, { force: true });
    del.run(videoId);
  }

  return {
    pathFor,

    has(videoId) {
      const p = pathFor(videoId);
      if (!p) return false;
      const row = selOne.get(videoId);
      if (!row) return false;
      // A row without a file (manual delete, failed write, restored backup)
      // must read as absent, or the proxy would 404 on its own cache.
      return existsSync(p);
    },

    record(videoId, bytes) {
      upsert.run({ id: videoId, bytes, at: now() });
    },

    recordPlay(videoId) {
      bumpPlay.run(now(), videoId);
    },

    playCount(videoId) {
      const row = selOne.get(videoId) as { play_count: number } | undefined;
      return row?.play_count ?? 0;
    },

    totalBytes() {
      return (selTotal.get() as { total: number }).total;
    },

    stats() {
      const r = selTotal.get() as { n: number; total: number };
      return { fileCount: r.n, totalBytes: r.total };
    },

    evict(maxBytes) {
      let total = (selTotal.get() as { total: number }).total;
      if (total <= maxBytes) return [];

      const removed: string[] = [];
      for (const row of selVictims.all() as Array<{ video_id: string; bytes: number }>) {
        if (total <= maxBytes) break;
        deleteFile(row.video_id);
        total -= row.bytes;
        removed.push(row.video_id);
      }
      return removed;
    },

    remove(videoId) {
      deleteFile(videoId);
    },
  };
}

/** Size on disk, or 0 if the file is missing. */
export function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
