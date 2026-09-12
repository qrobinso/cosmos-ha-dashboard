import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEntries, fetchCatalog, FEEDS } from '../src/aerials/catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'aerials-entries.json'), 'utf8'));

/** Same in-memory ustar builder as the untar test, kept tiny. */
function tarWith(name: string, body: Buffer): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0);
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([h, body, pad, Buffer.alloc(1024)]);
}

describe('parseEntries', () => {
  it('maps assets to the kiosk-facing shape and drops what cannot play or is hidden', () => {
    const assets = parseEntries(fixture);
    const ids = assets.map((a) => a.id);
    // Liwa: showInTopLevel=false → hidden. HEVC-only → dropped.
    expect(ids).not.toContain('001C94AE-2BA4-4E77-A202-F7DE60E8B1C8');
    expect(ids).not.toContain('FFFFFFFF-0000-0000-0000-000000000001');
    expect(assets).toHaveLength(5);

    const korea = assets.find((a) => a.id === '009BA758-7060-4479-8EE8-FB9B40C8FB97')!;
    expect(korea).toEqual({
      id: '009BA758-7060-4479-8EE8-FB9B40C8FB97',
      name: 'Korea and Japan Night',
      category: 'earth',
      subcategory: 'Korea and Japan Night',
      previewUrl: expect.stringMatching(/^https:\/\/sylvan\.apple\.com\/.*GMT026_363A_900x580\.png$/),
      sourceUrl: expect.stringMatching(/_SDR_2K_AVC\.mov$/),
    });
  });

  it('maps every category uuid to its slug', () => {
    const byId = new Map(parseEntries(fixture).map((a) => [a.id, a.category]));
    expect(byId.get('00BA71CD-2C54-415A-A68A-8358E677D750')).toBe('city');
    expect(byId.get('149E7795-DBDA-4F5D-B39A-14712F841118')).toBe('sea');
    expect(byId.get('0C747C29-4BF8-43F6-A5CC-2E012E555341')).toBe('landscape');
  });

  it('numbers repeated names so two Dubai clips are distinguishable', () => {
    const names = parseEntries(fixture).filter((a) => a.category === 'city').map((a) => a.name);
    expect(names).toEqual(['Dubai', 'Dubai 2']);
  });

  it('falls back to the localized key when the representative asset is absent', () => {
    // The fixture omits Dubai's representative asset, so the key
    // AerialSubcategoryCitiesDubai must be humanized instead.
    const dubai = parseEntries(fixture).find((a) => a.id === '00BA71CD-2C54-415A-A68A-8358E677D750');
    expect(dubai?.subcategory).toBe('Dubai');
  });

  it('keeps legacy-group shots that Apple still shows at top level', () => {
    const scotland = parseEntries(fixture).find((a) => a.id === '0C747C29-4BF8-43F6-A5CC-2E012E555341');
    expect(scotland?.name).toBe('Scotland');
  });

  it('omits the subcategory when the manifest does not name it', () => {
    const doc = {
      ...fixture,
      categories: fixture.categories.map((c: { subcategories: unknown[] }) => ({ ...c, subcategories: [] })),
    };
    const korea = parseEntries(doc).find((a) => a.id === '009BA758-7060-4479-8EE8-FB9B40C8FB97');
    expect(korea?.subcategory).toBeUndefined();
  });

  it('rejects a manifest that is not version 1 with an assets array', () => {
    expect(() => parseEntries({ version: 2, assets: [] })).toThrow(/version/);
    expect(() => parseEntries({ version: 1 })).toThrow(/assets/);
  });
});

describe('fetchCatalog', () => {
  it('downloads the primary feed, untars entries.json, and stamps the source', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response(tarWith('./entries.json', Buffer.from(JSON.stringify(fixture))), { status: 200 });
    }) as unknown as typeof fetch;

    const cat = await fetchCatalog({ fetchImpl, now: () => 1_700_000_000_000 });
    expect(calls).toEqual([FEEDS[0]]);
    expect(cat.source).toBe(FEEDS[0]);
    expect(cat.fetchedAt).toBe(1_700_000_000_000);
    expect(cat.assets).toHaveLength(5);
  });

  it('falls back to the next feed when the primary fails', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url === FEEDS[0]) return new Response('nope', { status: 404 });
      return new Response(tarWith('entries.json', Buffer.from(JSON.stringify(fixture))), { status: 200 });
    }) as unknown as typeof fetch;

    const cat = await fetchCatalog({ fetchImpl });
    expect(calls).toEqual([FEEDS[0], FEEDS[1]]);
    expect(cat.source).toBe(FEEDS[1]);
  });

  it('throws with every feed error when all feeds fail', async () => {
    const fetchImpl = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchCatalog({ fetchImpl })).rejects.toThrow(/500/);
  });

  it('throws when the tar has no entries.json', async () => {
    const fetchImpl = (async () =>
      new Response(tarWith('other.json', Buffer.from('{}')), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchCatalog({ fetchImpl })).rejects.toThrow(/entries\.json/);
  });
});
