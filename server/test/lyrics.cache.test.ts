import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createLyricsCache, LYRICS_NEGATIVE_TTL_MS } from '../src/lyrics/cache.js';

function setup(maxRows?: number) {
  const db = openDatabase(':memory:');
  runMigrations(db);
  let now = 1_000_000;
  const cache = createLyricsCache(db, { now: () => now, maxRows });
  return { cache, advance: (ms: number) => (now += ms) };
}

const hit = { synced: '[00:01.00]a', plain: 'a', instrumental: false };

describe('lyrics cache', () => {
  it('returns null when nothing is cached', () => {
    expect(setup().cache.get('a|b')).toBeNull();
  });

  it('round-trips a hit', () => {
    const { cache } = setup();
    cache.put('a|b', hit);
    expect(cache.get('a|b')).toEqual({ result: hit });
  });

  it('remembers a miss for 24h, then forgets it', () => {
    const { cache, advance } = setup();
    cache.put('a|b', null);
    expect(cache.get('a|b')).toEqual({ result: null });
    advance(LYRICS_NEGATIVE_TTL_MS + 1);
    expect(cache.get('a|b')).toBeNull();
  });

  it('prune drops expired misses and caps hits oldest-first', () => {
    const { cache, advance } = setup(2);
    cache.put('miss|x', null);
    advance(LYRICS_NEGATIVE_TTL_MS + 1);
    cache.put('a|1', hit);
    advance(1);
    cache.put('a|2', hit);
    advance(1);
    cache.put('a|3', hit);
    expect(cache.prune()).toBe(2);
    expect(cache.get('a|1')).toBeNull();
    expect(cache.get('a|3')).not.toBeNull();
  });

  it('a pin survives automatic puts, expiry and prune; unpin forgets it', () => {
    const { cache, advance } = setup(1);
    cache.pin('a|b', hit, 'A — B');
    cache.put('a|b', null); // a lookup that was in flight when the pin landed
    advance(1);
    cache.put('c|d', hit);
    cache.put('e|f', hit);
    cache.prune();
    expect(cache.get('a|b')).toEqual({ result: hit });
    expect(cache.info('a|b')).toMatchObject({ pinned: true, kind: 'synced', label: 'A — B' });
    expect(cache.list({ pinned: true }).map((r) => r.trackKey)).toEqual(['a|b']);
    expect(cache.unpin('a|b')).toBe(true);
    expect(cache.unpin('a|b')).toBe(false);
    expect(cache.get('a|b')).toBeNull();
  });

  it('a pinned miss is a block that never expires', () => {
    const { cache, advance } = setup();
    cache.pin('a|b', null);
    advance(LYRICS_NEGATIVE_TTL_MS * 10);
    cache.prune();
    expect(cache.get('a|b')).toEqual({ result: null });
    expect(cache.info('a|b')).toMatchObject({ pinned: true, kind: 'none' });
  });

  it('lists newest first and searches by track key', () => {
    const { cache, advance } = setup();
    cache.put('bowie|heroes', hit);
    advance(1);
    cache.put('queen|bohemian rhapsody', null);
    expect(cache.list().map((r) => r.trackKey)).toEqual(['queen|bohemian rhapsody', 'bowie|heroes']);
    expect(cache.list({ q: 'HERO' }).map((r) => r.trackKey)).toEqual(['bowie|heroes']);
  });
});
