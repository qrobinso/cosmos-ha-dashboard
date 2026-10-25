import type { DB } from '../store/db.js';
import type { LyricsResult } from './lrclib.js';

/** Lyrics get added to LRCLIB over time, so a miss is retried after a day. */
export const LYRICS_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
/** Bound on remembered hits; forgetting one costs a single LRCLIB request. */
export const LYRICS_MAX_ROWS = 5000;

export type LyricsCache = {
  /** null = not cached (or an expired miss); `{result: null}` = a cached miss. */
  get(trackKey: string): { result: LyricsResult | null } | null;
  put(trackKey: string, result: LyricsResult | null): void;
  /** Drop expired misses, then cap the table oldest-first. Returns rows removed. */
  prune(): number;
};

type Row = { synced: string | null; plain: string | null; instrumental: number; miss: number; fetched_at: number };

export function createLyricsCache(
  db: DB,
  opts: { now?: () => number; maxRows?: number } = {},
): LyricsCache {
  const now = opts.now ?? (() => Date.now());
  const maxRows = opts.maxRows ?? LYRICS_MAX_ROWS;
  const select = db.prepare('SELECT synced, plain, instrumental, miss, fetched_at FROM lyrics_cache WHERE track_key = ?');
  const upsert = db.prepare(
    `INSERT INTO lyrics_cache (track_key, synced, plain, instrumental, miss, fetched_at)
     VALUES (@key, @synced, @plain, @instrumental, @miss, @at)
     ON CONFLICT(track_key) DO UPDATE SET synced = @synced, plain = @plain,
       instrumental = @instrumental, miss = @miss, fetched_at = @at`,
  );
  const dropMisses = db.prepare('DELETE FROM lyrics_cache WHERE miss = 1 AND fetched_at < ?');
  const dropOverflow = db.prepare(
    `DELETE FROM lyrics_cache WHERE track_key IN (
       SELECT track_key FROM lyrics_cache ORDER BY fetched_at DESC LIMIT -1 OFFSET ?)`,
  );

  return {
    get(trackKey) {
      const row = select.get(trackKey) as Row | undefined;
      if (!row) return null;
      if (row.miss) return now() - row.fetched_at > LYRICS_NEGATIVE_TTL_MS ? null : { result: null };
      return { result: { synced: row.synced, plain: row.plain, instrumental: !!row.instrumental } };
    },
    put(trackKey, result) {
      upsert.run({
        key: trackKey,
        synced: result?.synced ?? null,
        plain: result?.plain ?? null,
        instrumental: result?.instrumental ? 1 : 0,
        miss: result ? 0 : 1,
        at: now(),
      });
    },
    prune() {
      return dropMisses.run(now() - LYRICS_NEGATIVE_TTL_MS).changes + dropOverflow.run(maxRows).changes;
    },
  };
}
