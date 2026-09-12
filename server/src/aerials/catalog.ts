import { untarEntry } from './untar.js';
import { appleFetch } from './fetch.js';
import type { AerialAsset, AerialCatalog, AerialCategory } from './types.js';

/**
 * Apple's tvOS aerial bundles, newest first.
 *
 * There is no pointer file for the tvOS feed (macOS has one, tvOS does not),
 * so this is a hardcoded constant that gets bumped when Apple ships a new
 * bundle — exactly what the Aerial screensaver does. The tvOS 16 bundle is the
 * fallback: still served, still H.264, just fewer clips and no subcategories.
 * Only tvOS bundles carry `url-1080-H264`; the macOS ones are 240fps HEVC and
 * cannot play in a browser.
 */
export const FEEDS: readonly string[] = [
  'https://sylvan.apple.com/itunes-assets/Aerials126/v4/c0/45/d9/c045d9d0-9606-1535-62fe-189edb4f79eb/resources-atv-23J-2.tar',
  'https://sylvan.apple.com/Aerials/resources-16.tar',
];

/** Category uuids → slugs. Unchanged since tvOS 16. */
export const CATEGORY_IDS: Record<string, AerialCategory> = {
  '55B7C95D-CEAF-4FD8-ADEF-F5BC657D8F6D': 'earth',
  'A33A55D9-EDEA-4596-A850-6C10B54FBBB5': 'landscape',
  '5EF41171-4862-4F93-800C-AD86CE5E6891': 'city',
  '8BE8B524-6EAE-43F5-A3E8-01DCFA1BCD4B': 'sea',
};

type RawAsset = {
  id?: unknown;
  accessibilityLabel?: unknown;
  categories?: unknown;
  subcategories?: unknown;
  previewImage?: unknown;
  showInTopLevel?: unknown;
  'url-1080-H264'?: unknown;
};

type RawCategory = {
  id?: unknown;
  subcategories?: Array<{ id?: unknown; localizedNameKey?: unknown; representativeAssetID?: unknown }>;
};

/** Fallback when a subcategory's representative asset is missing: the key
 *  `AerialSubcategoryCitiesDubai` becomes `Dubai`. Lossy for run-together
 *  words (`KoreaandJapanNight`), which is why the representative asset's
 *  label is preferred. */
function humanizeKey(key: string): string {
  return key
    .replace(/^AerialSubcategory/, '')
    .replace(/^Cities/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Reduce Apple's manifest to playable clips.
 *
 * Drops anything without an H.264 variant and anything Apple itself hides
 * (`showInTopLevel:false` marks alternate takes of a location the tvOS UI
 * never lists). Repeated names are numbered — Apple has three clips called
 * "Hawaii" — so a picker can tell them apart without showing shot ids.
 */
export function parseEntries(doc: unknown): AerialAsset[] {
  const d = doc as { version?: unknown; assets?: unknown; categories?: unknown };
  if (d?.version !== 1) throw new Error(`aerials: unsupported manifest version ${String(d?.version)}`);
  if (!Array.isArray(d.assets)) throw new Error('aerials: manifest has no assets array');

  const rawAssets = d.assets as RawAsset[];
  const labelById = new Map<string, string>();
  for (const raw of rawAssets) {
    const id = str(raw.id);
    const label = str(raw.accessibilityLabel);
    if (id && label) labelById.set(id, label);
  }

  // Subcategory display names: the representative asset's English label is
  // exact; the localizedNameKey is only a fallback.
  const subNames = new Map<string, string>();
  for (const c of (Array.isArray(d.categories) ? d.categories : []) as RawCategory[]) {
    for (const s of c.subcategories ?? []) {
      const id = str(s.id);
      if (!id) continue;
      const rep = str(s.representativeAssetID);
      const key = str(s.localizedNameKey);
      const name = (rep && labelById.get(rep)) ?? (key ? humanizeKey(key) : null);
      if (name) subNames.set(id, name);
    }
  }

  const out: AerialAsset[] = [];
  const seen = new Map<string, number>();
  for (const raw of rawAssets) {
    const id = str(raw.id);
    const sourceUrl = str(raw['url-1080-H264']);
    const label = str(raw.accessibilityLabel);
    if (!id || !sourceUrl || !label) continue;
    if (raw.showInTopLevel === false) continue;

    const catId = Array.isArray(raw.categories) ? str(raw.categories[0]) : null;
    const category = (catId && CATEGORY_IDS[catId]) || null;
    if (!category) continue;

    const subId = Array.isArray(raw.subcategories) ? str(raw.subcategories[0]) : null;
    const subcategory = subId ? subNames.get(subId) : undefined;

    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);

    out.push({
      id,
      name: n === 1 ? label : `${label} ${n}`,
      category,
      ...(subcategory ? { subcategory } : {}),
      previewUrl: str(raw.previewImage) ?? '',
      sourceUrl,
    });
  }
  return out;
}

export type FetchCatalogOpts = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  feeds?: readonly string[];
};

/** Try each feed in order; the first that yields a parseable manifest wins. */
export async function fetchCatalog(opts: FetchCatalogOpts = {}): Promise<AerialCatalog> {
  const doFetch = opts.fetchImpl ?? appleFetch;
  const now = opts.now ?? (() => Date.now());
  const feeds = opts.feeds ?? FEEDS;
  const errors: string[] = [];

  for (const url of feeds) {
    try {
      const res = await doFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const entry = untarEntry(buf, 'entries.json');
      if (!entry) throw new Error('no entries.json in bundle');
      const assets = parseEntries(JSON.parse(entry.toString('utf8')));
      return { fetchedAt: now(), source: url, assets };
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`aerials: every feed failed — ${errors.join('; ')}`);
}
