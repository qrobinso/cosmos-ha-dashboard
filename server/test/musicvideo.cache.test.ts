import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import type { DB } from '../src/store/db.js';
import {
  createMusicVideoCache,
  NEGATIVE_TTL_MS,
  STREAM_TTL_MS,
  MAX_CACHE_ROWS,
} from '../src/musicvideo/cache.js';

function freshDb(): DB {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

describe('music video cache', () => {
  let db: DB;
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
    clock = 1_000_000;
  });

  it('returns null for an unknown track key', () => {
    const cache = createMusicVideoCache(db, { now });
    expect(cache.getVideoId('bowie|heroes')).toBeNull();
  });

  it('round-trips a positive videoId', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('bowie|heroes', 'abc123');
    expect(cache.getVideoId('bowie|heroes')).toEqual({ videoId: 'abc123', miss: false });
  });

  it('never expires a positive videoId', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('bowie|heroes', 'abc123');
    clock += NEGATIVE_TTL_MS * 365;
    expect(cache.getVideoId('bowie|heroes')).toEqual({ videoId: 'abc123', miss: false });
  });

  it('records a negative result distinctly from an absent one', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('obscure|track', null);
    expect(cache.getVideoId('obscure|track')).toEqual({ videoId: null, miss: true, reason: null });
  });

  it('expires a negative result after the negative TTL', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('obscure|track', null);
    clock += NEGATIVE_TTL_MS + 1;
    expect(cache.getVideoId('obscure|track')).toBeNull();
  });

  it('lets a later positive result overwrite a negative one', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('obscure|track', null);
    cache.putVideoId('obscure|track', 'xyz789');
    expect(cache.getVideoId('obscure|track')).toEqual({ videoId: 'xyz789', miss: false });
  });

  it('round-trips a stream url', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putStream('abc123', 'https://rr1.googlevideo.com/x', 214);
    expect(cache.getStream('abc123')).toEqual({
      streamUrl: 'https://rr1.googlevideo.com/x',
      duration: 214,
    });
  });

  it('treats a stream url older than the stream TTL as absent', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putStream('abc123', 'https://rr1.googlevideo.com/x', 214);
    clock += STREAM_TTL_MS + 1;
    expect(cache.getStream('abc123')).toBeNull();
  });

  it('refreshes staleness when a stream url is re-put', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putStream('abc123', 'https://old', 214);
    clock += STREAM_TTL_MS - 1;
    cache.putStream('abc123', 'https://new', 214);
    clock += STREAM_TTL_MS - 1;
    expect(cache.getStream('abc123')).toEqual({ streamUrl: 'https://new', duration: 214 });
  });

  it('prune drops expired negatives but keeps live ones', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('old|miss', null);
    clock += NEGATIVE_TTL_MS + 1;
    cache.putVideoId('fresh|miss', null);

    const { negatives } = cache.prune();
    expect(negatives).toBe(1);
    expect(cache.getVideoId('fresh|miss')).toEqual({ videoId: null, miss: true, reason: null });
  });

  it('prune drops stale stream urls but keeps fresh ones', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putStream('stale', 'https://a', 1);
    clock += STREAM_TTL_MS + 1;
    cache.putStream('fresh', 'https://b', 1);

    const { streams } = cache.prune();
    expect(streams).toBe(1);
    expect(cache.getStream('fresh')?.streamUrl).toBe('https://b');
  });

  it('prune never drops a positive videoId inside the cap', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('bowie|heroes', 'abc123');
    clock += NEGATIVE_TTL_MS * 100;
    cache.prune();
    expect(cache.getVideoId('bowie|heroes')).toEqual({ videoId: 'abc123', miss: false });
  });

  it('prune caps the lookup table, evicting oldest first', () => {
    const cache = createMusicVideoCache(db, { now });
    for (let i = 0; i < MAX_CACHE_ROWS + 5; i++) {
      clock += 1000;
      cache.putVideoId(`artist|track${i}`, `vid${i}`);
    }
    const { overflow } = cache.prune();
    expect(overflow).toBe(5);
    // Oldest five gone, newest retained.
    expect(cache.getVideoId('artist|track0')).toBeNull();
    expect(cache.getVideoId(`artist|track${MAX_CACHE_ROWS + 4}`)).toEqual({
      videoId: `vid${MAX_CACHE_ROWS + 4}`,
      miss: false,
    });
  });

  it('drops a stream url on invalidate', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putStream('abc123', 'https://rr1.googlevideo.com/x', 214);
    cache.invalidateStream('abc123');
    expect(cache.getStream('abc123')).toBeNull();
  });

  it('keeps the videoId mapping when its stream is invalidated', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('bowie|heroes', 'abc123');
    cache.putStream('abc123', 'https://x', 1);
    cache.invalidateStream('abc123');
    expect(cache.getVideoId('bowie|heroes')).toEqual({ videoId: 'abc123', miss: false });
  });
});

describe('display names and history', () => {
  it('stores display names alongside a resolution', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('solange|weary', 'abc12345678', { artist: 'Solange', title: 'Weary' });

    const [entry] = cache.listRecent(10);
    expect(entry).toEqual({
      trackKey: 'solange|weary',
      videoId: 'abc12345678',
      miss: false,
      artist: 'Solange',
      title: 'Weary',
      reason: null,
      resolvedAt: 1000,
    });
  });

  it('records negative results in history so they can be pinned', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('radiohead|karma police', null, { artist: 'Radiohead', title: 'Karma Police' });

    const [entry] = cache.listRecent(10);
    // This is the case the admin page exists to fix — it must be listed.
    expect(entry.miss).toBe(true);
    expect(entry.videoId).toBeNull();
    expect(entry.artist).toBe('Radiohead');
  });

  it('tolerates a call with no display names', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('a|b', 'abc12345678');
    const [entry] = cache.listRecent(10);
    expect(entry.artist).toBeNull();
    expect(entry.title).toBeNull();
  });

  it('lists newest first and honours the limit', () => {
    const db = freshDb();
    let t = 0;
    const cache = createMusicVideoCache(db, { now: () => t });
    t = 100; cache.putVideoId('a|one', 'aaa11111111');
    t = 200; cache.putVideoId('b|two', 'bbb22222222');
    t = 300; cache.putVideoId('c|three', 'ccc33333333');

    expect(cache.listRecent(2).map((e) => e.trackKey)).toEqual(['c|three', 'b|two']);
  });

  it('does not erase existing display names when re-resolved without them', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('a|b', 'aaa11111111', { artist: 'A', title: 'B' });
    cache.putVideoId('a|b', 'ccc33333333');
    const [entry] = cache.listRecent(10);
    expect(entry.artist).toBe('A');
    expect(entry.videoId).toBe('ccc33333333');
  });
});

describe('history search', () => {
  /** Build a cache with a known set of songs, each at a distinct timestamp. */
  function seeded() {
    const db = freshDb();
    let t = 0;
    const cache = createMusicVideoCache(db, { now: () => t });
    const put = (
      key: string,
      videoId: string | null,
      names?: { artist?: string; title?: string },
    ) => {
      t += 100;
      cache.putVideoId(key, videoId, names);
    };
    return { cache, put };
  }

  it('finds a song by artist', () => {
    const { cache, put } = seeded();
    put('erykah badu|on & on', 'aaa11111111', { artist: 'Erykah Badu', title: 'On & On' });
    put('sza|snooze', 'bbb22222222', { artist: 'SZA', title: 'Snooze' });

    expect(cache.search('erykah', 50).map((e) => e.trackKey)).toEqual(['erykah badu|on & on']);
  });

  it('finds a song by title', () => {
    const { cache, put } = seeded();
    put('erykah badu|on & on', 'aaa11111111', { artist: 'Erykah Badu', title: 'On & On' });
    put('sza|snooze', 'bbb22222222', { artist: 'SZA', title: 'Snooze' });

    expect(cache.search('snooze', 50).map((e) => e.trackKey)).toEqual(['sza|snooze']);
  });

  it('is case-insensitive', () => {
    const { cache, put } = seeded();
    put('sza|snooze', 'bbb22222222', { artist: 'SZA', title: 'Snooze' });

    expect(cache.search('SNOOZE', 50)).toHaveLength(1);
    expect(cache.search('sZa', 50)).toHaveLength(1);
  });

  it('matches on the track key, so pre-v12 rows with no display names are searchable', () => {
    const { cache, put } = seeded();
    // Written before migration v12 added the artist/title columns.
    put('erykah badu|next to you', 'aaa11111111');

    const hits = cache.search('next to you', 50);
    expect(hits).toHaveLength(1);
    expect(hits[0].artist).toBeNull();
  });

  it('searches EVERY row, not just the recent window', () => {
    const { cache, put } = seeded();
    // The target is the oldest row; 80 newer songs bury it well past the
    // 50-row Recent list. This is the whole point of search.
    put('solange|weary', 'aaa11111111', { artist: 'Solange', title: 'Weary' });
    for (let i = 0; i < 80; i++) {
      put(`filler${i}|song`, 'ccc33333333', { artist: `Filler ${i}`, title: 'Song' });
    }

    expect(cache.listRecent(50).map((e) => e.trackKey)).not.toContain('solange|weary');
    expect(cache.search('weary', 50).map((e) => e.trackKey)).toEqual(['solange|weary']);
  });

  it('returns matches newest first and honours the limit', () => {
    const { cache, put } = seeded();
    put('a|love song', 'aaa11111111', { artist: 'A', title: 'Love Song' });
    put('b|love letter', 'bbb22222222', { artist: 'B', title: 'Love Letter' });
    put('c|love story', 'ccc33333333', { artist: 'C', title: 'Love Story' });

    expect(cache.search('love', 2).map((e) => e.trackKey)).toEqual(['c|love story', 'b|love letter']);
  });

  it('includes misses, which are the rows most worth finding', () => {
    const { cache, put } = seeded();
    put('radiohead|karma police', null, { artist: 'Radiohead', title: 'Karma Police' });

    const [hit] = cache.search('karma', 50);
    expect(hit.miss).toBe(true);
    expect(hit.videoId).toBeNull();
  });

  it('treats LIKE wildcards in the query as literal characters', () => {
    const { cache, put } = seeded();
    put('a|hello', 'aaa11111111', { artist: 'A', title: 'Hello' });
    put('b|100% real', 'bbb22222222', { artist: 'B', title: '100% Real' });

    // Unescaped, '%' would match everything and '_' would match any character.
    expect(cache.search('%', 50).map((e) => e.trackKey)).toEqual(['b|100% real']);
    expect(cache.search('_', 50)).toHaveLength(0);
  });

  it('returns nothing for a blank query rather than everything', () => {
    const { cache, put } = seeded();
    put('a|hello', 'aaa11111111', { artist: 'A', title: 'Hello' });

    expect(cache.search('', 50)).toEqual([]);
    expect(cache.search('   ', 50)).toEqual([]);
  });
});

describe('why nothing was found', () => {
  it('stores and returns the reason for a negative result', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('radiohead|karma police', null, {
      artist: 'Radiohead',
      title: 'Karma Police',
      reason: 'None of the 5 search results were on the artist’s channel.',
    });

    const cached = cache.getVideoId('radiohead|karma police');
    expect(cached).toMatchObject({
      videoId: null,
      miss: true,
      reason: 'None of the 5 search results were on the artist’s channel.',
    });
    // The History list needs it too — that is where a user reads it.
    expect(cache.listRecent(10)[0].reason).toBe(
      'None of the 5 search results were on the artist’s channel.',
    );
  });

  it('clears a stale reason once the track resolves successfully', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('a|b', null, { reason: 'nothing qualified' });
    cache.putVideoId('a|b', 'aaa11111111');

    // A hit has nothing to explain; leaving the old text would be actively
    // misleading next to a video that is now playing.
    expect(cache.listRecent(10)[0].reason).toBeNull();
  });

  it('leaves reason null when a miss is recorded without one', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('a|b', null);
    expect(cache.listRecent(10)[0].reason).toBeNull();
  });
});

describe('history paging', () => {
  function seededWith(n: number) {
    const db = freshDb();
    let t = 0;
    const cache = createMusicVideoCache(db, { now: () => t });
    for (let i = 0; i < n; i++) {
      t += 100;
      cache.putVideoId(`artist${i}|song${i}`, 'aaa11111111', {
        artist: `Artist ${i}`,
        title: `Song ${i}`,
      });
    }
    return cache;
  }

  it('pages through the full list without repeating or skipping a row', () => {
    const cache = seededWith(10);
    const page1 = cache.listRecent(4, 0).map((e) => e.trackKey);
    const page2 = cache.listRecent(4, 4).map((e) => e.trackKey);
    const page3 = cache.listRecent(4, 8).map((e) => e.trackKey);

    expect(page1).toHaveLength(4);
    expect(page2).toHaveLength(4);
    expect(page3).toHaveLength(2); // last partial page
    // Every row appears exactly once across the three pages.
    expect(new Set([...page1, ...page2, ...page3]).size).toBe(10);
  });

  it('counts every row so the page can size its pager', () => {
    expect(seededWith(7).count()).toBe(7);
  });

  it('counts only matching rows when searching', () => {
    const cache = seededWith(10);
    expect(cache.count('Song 1')).toBe(1);
    expect(cache.count('Artist')).toBe(10);
    expect(cache.count('nothing here')).toBe(0);
  });

  it('pages through search results too', () => {
    const cache = seededWith(10);
    const first = cache.search('Artist', 3, 0).map((e) => e.trackKey);
    const second = cache.search('Artist', 3, 3).map((e) => e.trackKey);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(first.some((k) => second.includes(k))).toBe(false);
  });

  it('counts a blank query as the whole table, matching listRecent', () => {
    const cache = seededWith(5);
    expect(cache.count('')).toBe(5);
    expect(cache.count('   ')).toBe(5);
  });

  it('escapes LIKE wildcards when counting, exactly as when searching', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1 });
    cache.putVideoId('a|hello', 'aaa11111111', { artist: 'A', title: 'Hello' });
    cache.putVideoId('b|pct', 'bbb22222222', { artist: 'B', title: '100% Real' });
    // A count that forgot to escape would report both rows.
    expect(cache.count('%')).toBe(1);
  });
});
