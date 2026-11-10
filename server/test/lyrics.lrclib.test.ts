import { describe, it, expect } from 'vitest';
import { createLrclibClient } from '../src/lyrics/lrclib.js';

type Route = (url: URL) => { status: number; body?: unknown };

function fakeFetch(route: Route) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const { status, body } = route(url);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

const record = (over: Record<string, unknown> = {}) => ({
  trackName: 'Heroes',
  artistName: 'David Bowie',
  duration: 371,
  instrumental: false,
  plainLyrics: 'I, I will be king',
  syncedLyrics: '[00:20.00]I, I will be king',
  ...over,
});

describe('createLrclibClient', () => {
  it('returns lyrics from /api/get with artist, title and rounded duration', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: record() }));
    const out = await createLrclibClient({ fetch: fn }).get({ artist: 'david bowie', title: 'heroes', durationSec: 370.6 });
    expect(out).toEqual({ synced: '[00:20.00]I, I will be king', plain: 'I, I will be king', instrumental: false });
    expect(calls[0].url.pathname).toBe('/api/get');
    expect(calls[0].url.searchParams.get('artist_name')).toBe('david bowie');
    expect(calls[0].url.searchParams.get('track_name')).toBe('heroes');
    expect(calls[0].url.searchParams.get('duration')).toBe('371');
    expect(calls[0].headers['User-Agent']).toBe('Cosmos Dashboard (https://github.com/qrobinso/cosmos-ha-dashboard)');
  });

  it('falls back to /api/search and picks the first result within 3s', async () => {
    const { fn, calls } = fakeFetch((u) =>
      u.pathname === '/api/get'
        ? { status: 404 }
        : { status: 200, body: [record({ duration: 300, plainLyrics: 'live' }), record({ duration: 369, plainLyrics: 'studio' })] },
    );
    const out = await createLrclibClient({ fetch: fn }).get({ artist: 'a', title: 'b', durationSec: 371 });
    expect(out?.plain).toBe('studio');
    expect(calls[1].url.pathname).toBe('/api/search');
  });

  it('treats a search with no duration match as not found', async () => {
    const { fn } = fakeFetch((u) => (u.pathname === '/api/get' ? { status: 404 } : { status: 200, body: [record({ duration: 200 })] }));
    expect(await createLrclibClient({ fetch: fn }).get({ artist: 'a', title: 'b', durationSec: 371 })).toBeNull();
  });

  it('takes the first search result when duration is unknown', async () => {
    const { fn } = fakeFetch((u) => (u.pathname === '/api/get' ? { status: 404 } : { status: 200, body: [record({ duration: 200, plainLyrics: 'first' })] }));
    expect((await createLrclibClient({ fetch: fn }).get({ artist: 'a', title: 'b' }))?.plain).toBe('first');
  });

  it('returns null when search is empty', async () => {
    const { fn } = fakeFetch((u) => (u.pathname === '/api/get' ? { status: 404 } : { status: 200, body: [] }));
    expect(await createLrclibClient({ fetch: fn }).get({ artist: 'a', title: 'b' })).toBeNull();
  });

  it('passes instrumental through', async () => {
    const { fn } = fakeFetch(() => ({ status: 200, body: record({ instrumental: true, plainLyrics: null, syncedLyrics: null }) }));
    expect(await createLrclibClient({ fetch: fn }).get({ artist: 'a', title: 'b' })).toEqual({ synced: null, plain: null, instrumental: true });
  });

  it('throws on a server error so the caller does not cache it', async () => {
    const { fn } = fakeFetch(() => ({ status: 500 }));
    await expect(createLrclibClient({ fetch: fn }).get({ artist: 'a', title: 'b' })).rejects.toThrow(/500/);
  });

  it('search returns candidates that have something to show, by free text', async () => {
    const { fn, calls } = fakeFetch(() => ({
      status: 200,
      body: [
        record({ id: 7, albumName: 'Heroes' }),
        record({ id: 8, syncedLyrics: null }),
        record({ id: 9, syncedLyrics: null, plainLyrics: null }),
      ],
    }));
    const out = await createLrclibClient({ fetch: fn }).search('bowie heroes');
    expect(calls[0].url.pathname).toBe('/api/search');
    expect(calls[0].url.searchParams.get('q')).toBe('bowie heroes');
    expect(out).toEqual([
      { id: 7, track: 'Heroes', artist: 'David Bowie', album: 'Heroes', durationSec: 371, synced: true, instrumental: false },
      { id: 8, track: 'Heroes', artist: 'David Bowie', album: null, durationSec: 371, synced: false, instrumental: false },
    ]);
  });

  it('byId fetches one record with its lyrics; 404 is null', async () => {
    const { fn, calls } = fakeFetch((u) => (u.pathname === '/api/get/7' ? { status: 200, body: record({ id: 7 }) } : { status: 404 }));
    const client = createLrclibClient({ fetch: fn });
    const out = await client.byId(7);
    expect(calls[0].url.pathname).toBe('/api/get/7');
    expect(out?.candidate.id).toBe(7);
    expect(out?.result).toEqual({ synced: '[00:20.00]I, I will be king', plain: 'I, I will be king', instrumental: false });
    expect(await client.byId(8)).toBeNull();
  });
});
