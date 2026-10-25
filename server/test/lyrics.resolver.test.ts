import { describe, it, expect, vi } from 'vitest';
import { openDatabase } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createLyricsCache } from '../src/lyrics/cache.js';
import { createLyricsResolver } from '../src/lyrics/resolver.js';
import type { LyricsFetch, LyricsResult } from '../src/lyrics/lrclib.js';

function setup(get: LyricsFetch['get'], opts: { retryMs?: number } = {}) {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const cache = createLyricsCache(db);
  const onUpdate = vi.fn();
  const fetcher = { get: vi.fn(get) };
  const resolve = createLyricsResolver(fetcher, cache, onUpdate, opts);
  return { resolve, fetcher, onUpdate, cache };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const track = { artist: 'David Bowie', title: 'Heroes (Remastered 2011)', durationSec: 371 };
const synced: LyricsResult = { synced: '[00:01.00]we can be heroes\n[00:05.00]just for one day\n[00:09.00]we can be heroes', plain: 'x', instrumental: false };

describe('lyrics resolver', () => {
  it('returns null immediately on a miss, fetches once per track, then notifies every waiter', async () => {
    const { resolve, fetcher, onUpdate } = setup(async () => synced);
    expect(resolve('w1', track).lines).toBeNull();
    expect(resolve('w2', track).lines).toBeNull();
    expect(fetcher.get).toHaveBeenCalledTimes(1);
    expect(fetcher.get).toHaveBeenCalledWith({ artist: 'david bowie', title: 'heroes', durationSec: 371 });
    await settle();
    expect(onUpdate.mock.calls.map((c) => c[0]).sort()).toEqual(['w1', 'w2']);

    const out = resolve('w1', track);
    expect(out.synced).toBe(true);
    expect(out.trackKey).toBe('david bowie|heroes');
    expect(out.lines).toEqual([
      { t: 1, text: 'we can be heroes', chorus: true },
      { t: 5, text: 'just for one day' },
      { t: 9, text: 'we can be heroes', chorus: true },
    ]);
  });

  it('falls back to plain lyrics when synced parses to nothing', async () => {
    const { resolve } = setup(async () => ({ synced: '[ar:x]', plain: 'one\ntwo', instrumental: false }));
    resolve('w1', track);
    await settle();
    expect(resolve('w1', track)).toMatchObject({ synced: false, lines: [{ text: 'one' }, { text: 'two' }] });
  });

  it('hides instrumentals and misses', async () => {
    const { resolve } = setup(async () => ({ synced: null, plain: null, instrumental: true }));
    resolve('w1', track);
    await settle();
    expect(resolve('w1', track).lines).toBeNull();
  });

  it('does not cache errors, so the next push retries', async () => {
    let fail = true;
    const { resolve, fetcher, onUpdate } = setup(async () => {
      if (fail) throw new Error('down');
      return synced;
    });
    resolve('w1', track);
    await settle();
    expect(onUpdate).not.toHaveBeenCalled();
    fail = false;
    resolve('w1', track);
    expect(fetcher.get).toHaveBeenCalledTimes(2);
  });

  it('does not notify a disposed widget', async () => {
    const { resolve, onUpdate } = setup(async () => synced);
    resolve('w1', track);
    resolve.dispose('w1');
    await settle();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('returns null without fetching when artist or title is missing', () => {
    const { resolve, fetcher } = setup(async () => synced);
    expect(resolve('w1', { title: 'x' })).toEqual({ lines: null, synced: false, trackKey: null });
    expect(fetcher.get).not.toHaveBeenCalled();
  });

  it('retries a lookup dropped at the concurrency cap once a slot frees', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { resolve, fetcher, onUpdate } = setup(async () => {
      await gate;
      return synced;
    });
    resolve('w1', { artist: 'a', title: '1' });
    resolve('w2', { artist: 'a', title: '2' });
    resolve('w3', { artist: 'a', title: '3' }); // over MAX_CONCURRENT_LYRICS_LOOKUPS
    expect(fetcher.get).toHaveBeenCalledTimes(2);
    release();
    await settle();
    expect(onUpdate.mock.calls.map((c) => c[0])).toContain('w3');
  });

  it('re-pushes after a failed lookup so it is retried', async () => {
    const { resolve, onUpdate } = setup(async () => {
      throw new Error('down');
    }, { retryMs: 5 });
    resolve('w1', track);
    await new Promise((r) => setTimeout(r, 20));
    expect(onUpdate).toHaveBeenCalledWith('w1');
  });
});
