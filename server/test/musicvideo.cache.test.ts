import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import type { DB } from '../src/store/db.js';
import {
  createMusicVideoCache,
  NEGATIVE_TTL_MS,
  STREAM_TTL_MS,
} from '../src/musicvideo/cache.js';

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
