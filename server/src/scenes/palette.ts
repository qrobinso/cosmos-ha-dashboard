/**
 * Pure reducer that turns per-widget palette contributions into the final
 * gradient palette. Lives on the server: every display's contributions live
 * in `displayPalette` and feed this reducer in `assemblePush` /
 * `displayPalette.set`.
 *
 *   contributions  Map<widgetId, [#rrggbb, ...]>
 *   fallback       The user's `gradient.colors` — used to pad if we don't
 *                  have enough distinct colors to fill the gradient.
 *   targetCount    Number of stops to return. The kiosk uses 3.
 *
 * Empty contributions → empty output (the caller treats empty as "don't
 * override the user's colors"). All-near-duplicate contributions collapse
 * to one stop and get padded.
 */
export function reducePalette(
  contributions: Map<string, string[]>,
  fallback: string[],
  targetCount: number
): string[] {
  const freq = new Map<string, number>();
  const insertionOrder: string[] = [];
  for (const colors of contributions.values()) {
    for (const c of colors) {
      const norm = c.toLowerCase();
      if (!freq.has(norm)) insertionOrder.push(norm);
      freq.set(norm, (freq.get(norm) ?? 0) + 1);
    }
  }
  if (freq.size === 0) return [];

  const sorted = insertionOrder.slice().sort((a, b) => {
    const diff = (freq.get(b) ?? 0) - (freq.get(a) ?? 0);
    if (diff !== 0) return diff;
        // Tie-break by insertion order: first-seen widget's contribution wins.
    return insertionOrder.indexOf(a) - insertionOrder.indexOf(b);
  });

  const kept: string[] = [];
  for (const color of sorted) {
    if (kept.length >= targetCount) break;
    if (kept.every((k) => hslDistance(k, color) >= 0.15)) kept.push(color);
  }

  // Pad from the user's gradient.colors. Note the asymmetry vs. the loop above:
  // contributions are auto-extracted and may include perceptually near-duplicate
  // colors that should collapse to one stop, but fallback colors are user-picked
  // and intentional — if the user chose three near-identical grays, honor that.
  for (const c of fallback) {
    if (kept.length >= targetCount) break;
    const norm = c.toLowerCase();
    if (!kept.includes(norm)) kept.push(norm);
  }

  return kept;
}

/** HSL-distance proxy. Hex strings only; behavior is undefined for malformed
 *  input, which the reducer never produces (validated upstream at the API). */
function hslDistance(a: string, b: string): number {
  const [hA, sA, lA] = hexToHsl(a);
  const [hB, sB, lB] = hexToHsl(b);
  const dh = Math.min(Math.abs(hA - hB), 1 - Math.abs(hA - hB));
  const ds = Math.abs(sA - sB);
  const dl = Math.abs(lA - lB);
  return Math.sqrt(dh * dh + ds * ds * 0.5 + dl * dl * 0.5);
}

function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    case b: h = ((r - g) / d + 4) / 6; break;
  }
  return [h, s, l];
}
