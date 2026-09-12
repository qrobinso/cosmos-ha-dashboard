import type { AerialAsset, AerialCategory } from './types.js';

/** The part of an aerials background that names clips. */
export type AerialSelection = {
  ids: string[];
  categories?: AerialCategory[];
};

/**
 * Turn a scene's selection into the ordered clip list it plays.
 *
 * Whole categories come first in catalog order — so "all Landscape" keeps
 * Apple's sequencing and picks up clips Apple adds later — then the
 * individually picked ids in the user's order. Duplicates and ids no longer
 * in the catalog are dropped.
 */
export function expandSelection(sel: AerialSelection, assets: AerialAsset[]): AerialAsset[] {
  const cats = new Set(sel.categories ?? []);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const out: AerialAsset[] = [];
  const push = (a: AerialAsset | undefined) => {
    if (!a || seen.has(a.id)) return;
    seen.add(a.id);
    out.push(a);
  };
  if (cats.size > 0) for (const a of assets) if (cats.has(a.category)) push(a);
  for (const id of sel.ids) push(byId.get(id));
  return out;
}
