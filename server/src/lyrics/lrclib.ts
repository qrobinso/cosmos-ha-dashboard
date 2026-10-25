/**
 * LRCLIB client — the only file that knows LRCLIB exists (https://lrclib.net,
 * free, no key). Returns null for "no lyrics", throws on transport/server
 * errors so the resolver can tell "looked, nothing" from "couldn't look".
 */

export type LyricsResult = { synced: string | null; plain: string | null; instrumental: boolean };

export type LyricsQuery = { artist: string; title: string; durationSec?: number };

export type LyricsFetch = { get(q: LyricsQuery): Promise<LyricsResult | null> };

const USER_AGENT = 'Cosmos Dashboard (https://github.com/qrobinso/cosmos-ha-dashboard)';
const TIMEOUT_MS = 8000;
/** A search hit further than this from the player's track length is a different
 *  recording (live, edit) whose timings would be wrong — worse than nothing. */
const DURATION_TOLERANCE_S = 3;

type LrclibRecord = {
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

export function createLrclibClient(opts: { fetch?: typeof fetch; baseUrl?: string } = {}): LyricsFetch {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? 'https://lrclib.net';

  async function call(path: string, params: Record<string, string>): Promise<unknown | null> {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await doFetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`lrclib ${path} returned ${res.status}`);
    return res.json();
  }

  const toResult = (r: LrclibRecord): LyricsResult => ({
    synced: r.syncedLyrics || null,
    plain: r.plainLyrics || null,
    instrumental: !!r.instrumental,
  });

  return {
    async get({ artist, title, durationSec }) {
      const params: Record<string, string> = { artist_name: artist, track_name: title };
      if (durationSec) params.duration = String(Math.round(durationSec));
      const hit = (await call('/api/get', params)) as LrclibRecord | null;
      if (hit) return toResult(hit);

      const results = (await call('/api/search', { artist_name: artist, track_name: title })) as LrclibRecord[] | null;
      if (!Array.isArray(results) || results.length === 0) return null;
      const pick = durationSec
        ? results.find((r) => typeof r.duration === 'number' && Math.abs(r.duration - durationSec) <= DURATION_TOLERANCE_S)
        : results[0];
      return pick ? toResult(pick) : null;
    },
  };
}
