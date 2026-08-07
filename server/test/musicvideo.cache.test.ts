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
    expect(cache.getVideoId('obscure|track')).toEqual({ videoId: null, miss: true });
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
    expect(cache.getVideoId('fresh|miss')).toEqual({ videoId: null, miss: true });
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
