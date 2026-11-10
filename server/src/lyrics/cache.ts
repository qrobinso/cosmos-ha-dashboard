import type { DB } from '../store/db.js';
import type { LyricsResult } from './lrclib.js';

/** Lyrics get added to LRCLIB over time, so a miss is retried after a day. */
export const LYRICS_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
/** Bound on remembered hits; forgetting one costs a single LRCLIB request. */
export const LYRICS_MAX_ROWS = 5000;
const LIST_LIMIT = 50;
/** Search reaches every remembered song, so it gets a higher ceiling than Recent. */
const SEARCH_LIMIT = 200;

/** One remembered song, without the lyrics text — for the admin page's lists. */
export type LyricsRow = {
  trackKey: string;
  /** A manual choice: `kind: 'none'` + pinned is a block. */
  pinned: boolean;
  kind: 'synced' | 'plain' | 'instrumental' | 'none';
  /** The LRCLIB record a pin was picked from. */
  label: string | null;
  fetchedAt: number;
};

export type LyricsCache = {
  /** null = not cached (or an expired miss); `{result: null}` = a cached miss. */
  get(trackKey: string): { result: LyricsResult | null } | null;
  /** Automatic lookups land here. Never overwrites a pin. */
  put(trackKey: string, result: LyricsResult | null): void;
  /** Manual choice; `null` blocks lyrics for the song. Outlives prune and expiry. */
  pin(trackKey: string, result: LyricsResult | null, label?: string): void;
  /** Forget a pin so the song goes back to automatic matching. */
  unpin(trackKey: string): boolean;
  info(trackKey: string): LyricsRow | null;
  /** Newest first. `q` matches anywhere in the track key. */
  list(opts?: { q?: string; pinned?: boolean }): LyricsRow[];
  /** Drop expired misses, then cap the table oldest-first. Returns rows removed. */
  prune(): number;
};

type Row = {
  track_key: string;
  synced: string | null;
  plain: string | null;
  instrumental: number;
  miss: number;
  pinned: number;
  label: string | null;
  fetched_at: number;
};

const toRow = (r: Row): LyricsRow => ({
  trackKey: r.track_key,
  pinned: !!r.pinned,
  kind: r.miss ? 'none' : r.instrumental ? 'instrumental' : r.synced ? 'synced' : r.plain ? 'plain' : 'none',
  label: r.label,
  fetchedAt: r.fetched_at,
});

export function createLyricsCache(
  db: DB,
  opts: { now?: () => number; maxRows?: number } = {},
): LyricsCache {
  const now = opts.now ?? (() => Date.now());
  const maxRows = opts.maxRows ?? LYRICS_MAX_ROWS;
  const select = db.prepare('SELECT * FROM lyrics_cache WHERE track_key = ?');
  const upsert = (guard: string) =>
    db.prepare(
      `INSERT INTO lyrics_cache (track_key, synced, plain, instrumental, miss, pinned, label, fetched_at)
       VALUES (@key, @synced, @plain, @instrumental, @miss, @pinned, @label, @at)
       ON CONFLICT(track_key) DO UPDATE SET synced = @synced, plain = @plain,
         instrumental = @instrumental, miss = @miss, pinned = @pinned, label = @label, fetched_at = @at
       ${guard}`,
    );
  // The guard is what stops a lookup already in flight from clobbering a pin.
  const upsertAuto = upsert('WHERE lyrics_cache.pinned = 0');
  const upsertPin = upsert('');
  const remove = db.prepare('DELETE FROM lyrics_cache WHERE track_key = ? AND pinned = 1');
  const listAll = db.prepare(
    `SELECT * FROM lyrics_cache
     WHERE (@pinned IS NULL OR pinned = @pinned) AND (@q IS NULL OR instr(track_key, @q) > 0)
     ORDER BY fetched_at DESC, rowid DESC LIMIT @limit`,
  );
  const dropMisses = db.prepare('DELETE FROM lyrics_cache WHERE miss = 1 AND pinned = 0 AND fetched_at < ?');
  const dropOverflow = db.prepare(
    `DELETE FROM lyrics_cache WHERE track_key IN (
       SELECT track_key FROM lyrics_cache WHERE pinned = 0 ORDER BY fetched_at DESC LIMIT -1 OFFSET ?)`,
  );

  const params = (trackKey: string, result: LyricsResult | null, pinned: number, label: string | null) => ({
    key: trackKey,
    synced: result?.synced ?? null,
    plain: result?.plain ?? null,
    instrumental: result?.instrumental ? 1 : 0,
    miss: result ? 0 : 1,
    pinned,
    label,
    at: now(),
  });

  return {
    get(trackKey) {
      const row = select.get(trackKey) as Row | undefined;
      if (!row) return null;
      if (row.miss) {
        return !row.pinned && now() - row.fetched_at > LYRICS_NEGATIVE_TTL_MS ? null : { result: null };
      }
      return { result: { synced: row.synced, plain: row.plain, instrumental: !!row.instrumental } };
    },
    put(trackKey, result) {
      upsertAuto.run(params(trackKey, result, 0, null));
    },
    pin(trackKey, result, label) {
      upsertPin.run(params(trackKey, result, 1, label ?? null));
    },
    unpin(trackKey) {
      return remove.run(trackKey).changes > 0;
    },
    info(trackKey) {
      const row = select.get(trackKey) as Row | undefined;
      return row ? toRow(row) : null;
    },
    list({ q, pinned } = {}) {
      const needle = q?.trim().toLowerCase() || null; // track keys are stored lowercase
      return (
        listAll.all({
          q: needle,
          pinned: pinned === undefined ? null : pinned ? 1 : 0,
          limit: needle ? SEARCH_LIMIT : LIST_LIMIT,
        }) as Row[]
      ).map(toRow);
    },
    prune() {
      return dropMisses.run(now() - LYRICS_NEGATIVE_TTL_MS).changes + dropOverflow.run(maxRows).changes;
    },
  };
}
