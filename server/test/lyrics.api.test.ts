import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { openDatabase } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createLyricsCache } from '../src/lyrics/cache.js';
import { createFakeHaClient } from '../src/ha/fakeClient.js';
import { registerLyricsRoutes } from '../src/api/lyrics.js';
import { ADMIN_ENTITY_SETTING } from '../src/api/musicvideo.js';
import type { LyricsCandidate, LyricsSearch } from '../src/lyrics/lrclib.js';

const candidate: LyricsCandidate = {
  id: 7, track: 'Heroes', artist: 'David Bowie', album: 'Heroes', durationSec: 371, synced: true, instrumental: false,
};
const result = { synced: '[00:01.00]we can be heroes\n[00:05.00]just for one day', plain: null, instrumental: false };

function harness(search: Partial<LyricsSearch> = {}) {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const cache = createLyricsCache(db);
  const settings = createSettingsRepo(db);
  const haClient = createFakeHaClient([
    { entity_id: 'media_player.kitchen', state: 'playing',
      attributes: { media_artist: 'David Bowie', media_title: 'Heroes (Remastered 2011)', media_duration: 371 } },
  ]);
  const onChanged = vi.fn();
  const resolver = vi.fn();
  const app = Fastify();
  registerLyricsRoutes(app, {
    cache,
    search: {
      search: async () => [candidate],
      byId: async (id) => (id === 7 ? { candidate, result } : null),
      ...search,
    },
    settings,
    haClient,
    resolver: () => resolver as never,
    onChanged,
  });
  return { app, cache, settings, onChanged, resolver };
}

describe('lyrics admin routes', () => {
  it('pins a chosen LRCLIB record to a track key and lists it', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/lyrics/pins', payload: { trackKey: 'david bowie|heroes', lrclibId: 7 } });
    expect(res.statusCode).toBe(200);
    expect(h.cache.get('david bowie|heroes')).toEqual({ result });
    expect(h.onChanged).toHaveBeenCalledWith('david bowie|heroes');
    const pins = (await h.app.inject({ method: 'GET', url: '/api/lyrics/pins' })).json();
    expect(pins).toMatchObject([{ trackKey: 'david bowie|heroes', pinned: true, kind: 'synced', label: 'David Bowie — Heroes (Heroes)' }]);
  });

  it('blocks a song, and removing the pin returns it to automatic', async () => {
    const h = harness();
    await h.app.inject({ method: 'POST', url: '/api/lyrics/pins', payload: { trackKey: 'a|b', block: true } });
    expect(h.cache.get('a|b')).toEqual({ result: null });
    const del = await h.app.inject({ method: 'DELETE', url: `/api/lyrics/pins/${encodeURIComponent('a|b')}` });
    expect(del.statusCode).toBe(200);
    expect(h.cache.get('a|b')).toBeNull();
    expect(h.onChanged).toHaveBeenCalledTimes(2);
    expect((await h.app.inject({ method: 'DELETE', url: '/api/lyrics/pins/a%7Cb' })).statusCode).toBe(404);
  });

  it('rejects a bad track key, a missing choice, and a record LRCLIB no longer has', async () => {
    const h = harness();
    const post = (payload: object) => h.app.inject({ method: 'POST', url: '/api/lyrics/pins', payload });
    expect((await post({ trackKey: 'nopipe', lrclibId: 7 })).statusCode).toBe(400);
    expect((await post({ trackKey: 'a|b' })).statusCode).toBe(400);
    expect((await post({ trackKey: 'a|b', lrclibId: 99 })).statusCode).toBe(400);
    expect(h.onChanged).not.toHaveBeenCalled();
  });

  it('search proxies LRCLIB and reports an outage as 502', async () => {
    const ok = harness();
    expect((await ok.app.inject({ method: 'GET', url: '/api/lyrics/search?q=bowie' })).json()).toEqual([candidate]);
    expect((await ok.app.inject({ method: 'GET', url: '/api/lyrics/search?q=' })).json()).toEqual([]);
    const down = harness({ search: async () => { throw new Error('boom'); } });
    expect((await down.app.inject({ method: 'GET', url: '/api/lyrics/search?q=bowie' })).statusCode).toBe(502);
  });

  it('now-playing describes the watched player, starting a lookup when nothing is known', async () => {
    const h = harness();
    const get = async () => (await h.app.inject({ method: 'GET', url: '/api/lyrics/now-playing' })).json();
    expect(await get()).toMatchObject({ entityId: null, status: 'no-entity' });

    h.settings.set(ADMIN_ENTITY_SETTING, 'media_player.kitchen');
    expect(await get()).toMatchObject({ trackKey: 'david bowie|heroes', status: 'unresolved', durationSec: 371 });
    expect(h.resolver).toHaveBeenCalledTimes(1);

    h.cache.put('david bowie|heroes', result);
    expect(await get()).toMatchObject({ status: 'auto', kind: 'synced', preview: ['we can be heroes', 'just for one day'] });

    h.cache.pin('david bowie|heroes', null);
    expect(await get()).toMatchObject({ status: 'blocked', preview: [] });
  });

  it('history lists remembered songs and filters by q', async () => {
    const h = harness();
    h.cache.put('david bowie|heroes', result);
    h.cache.put('queen|bohemian rhapsody', null);
    const all = (await h.app.inject({ method: 'GET', url: '/api/lyrics/history' })).json();
    expect(all).toHaveLength(2);
    const some = (await h.app.inject({ method: 'GET', url: '/api/lyrics/history?q=queen' })).json();
    expect(some).toMatchObject([{ trackKey: 'queen|bohemian rhapsody', kind: 'none', pinned: false }]);
  });
});
