import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createAerialCatalogStore } from '../src/aerials/store.js';
import { createCatalogRefresher, CATALOG_MAX_AGE_MS } from '../src/aerials/refresh.js';
import type { AerialCatalog } from '../src/aerials/types.js';

function settings() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return createSettingsRepo(db);
}

const sample: AerialCatalog = {
  fetchedAt: 1000,
  source: 'https://example/feed.tar',
  assets: [
    { id: 'A', name: 'Alpha', category: 'earth', previewUrl: '', sourceUrl: 'https://x/a.mov' },
  ],
};

describe('aerial catalog store', () => {
  it('round-trips through the settings table and reads null when unset', () => {
    const store = createAerialCatalogStore(settings());
    expect(store.get()).toBeNull();
    store.set(sample);
    expect(store.get()).toEqual(sample);
    expect(store.assets()).toEqual(sample.assets);
  });

  it('treats a corrupt row as absent rather than throwing', () => {
    const s = settings();
    s.set('aerials.catalog', '{not json');
    const store = createAerialCatalogStore(s);
    expect(store.get()).toBeNull();
    expect(store.assets()).toEqual([]);
  });
});

describe('catalog refresher', () => {
  function harness(opts: { existing?: AerialCatalog | null; now?: number; fail?: boolean } = {}) {
    const store = createAerialCatalogStore(settings());
    if (opts.existing) store.set(opts.existing);
    let t = opts.now ?? 10_000;
    let fetches = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const fetchCatalog = async (): Promise<AerialCatalog> => {
      fetches++;
      await gate;
      if (opts.fail) throw new Error('feed down');
      return { ...sample, fetchedAt: t };
    };
    const r = createCatalogRefresher({ store, fetchCatalog, now: () => t });
    return { store, r, release, fetches: () => fetches, tick: (ms: number) => { t += ms; } };
  }

  it('refreshNow fetches, stores, and returns the catalog', async () => {
    const h = harness();
    h.release();
    const cat = await h.r.refreshNow();
    expect(cat.assets).toHaveLength(1);
    expect(h.store.get()?.fetchedAt).toBe(10_000);
  });

  it('collapses concurrent refreshes into one fetch', async () => {
    const h = harness();
    const a = h.r.refreshNow();
    const b = h.r.refreshNow();
    h.release();
    await Promise.all([a, b]);
    expect(h.fetches()).toBe(1);
  });

  it('refreshIfStale skips a fresh catalog and refetches an old one', async () => {
    const h = harness({ existing: { ...sample, fetchedAt: 10_000 } });
    h.release();
    expect(await h.r.refreshIfStale()).toBe(false);
    expect(h.fetches()).toBe(0);

    h.tick(CATALOG_MAX_AGE_MS + 1);
    expect(await h.r.refreshIfStale()).toBe(true);
    expect(h.fetches()).toBe(1);
  });

  it('refreshIfStale keeps the old catalog and reports false when the feed fails', async () => {
    const h = harness({ existing: sample, now: sample.fetchedAt + CATALOG_MAX_AGE_MS + 1, fail: true });
    h.release();
    expect(await h.r.refreshIfStale()).toBe(false);
    expect(h.store.get()).toEqual(sample);
  });

  it('refreshNow rethrows so the API can report the failure', async () => {
    const h = harness({ fail: true });
    h.release();
    await expect(h.r.refreshNow()).rejects.toThrow(/feed down/);
  });
});
