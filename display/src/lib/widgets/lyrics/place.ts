/** Axis-aligned box in px, relative to the widget. */
export type Rect = { x: number; y: number; w: number; h: number };
/** A placement; `clear` is false when nothing fit and this is the least-bad spot. */
export type Placement = Rect & { clear: boolean };

export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Small seeded PRNG (mulberry32) — placement must be repeatable per line. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRIES = 120;

/**
 * Pick a spot for a `size` rect inside `box` that touches none of `taken`.
 * Callers pass the space a line SWEEPS over its whole float (not just its
 * starting box), so two lines can't drift into each other later either.
 * Random seeded candidates rather than a grid, so placement looks organic.
 * If nothing fits (huge text, tiny widget) the least-overlapping spot wins.
 */
export function placeLine(size: { w: number; h: number }, box: { w: number; h: number }, taken: Rect[], seed: number): Placement {
  const w = Math.min(size.w, box.w);
  const h = Math.min(size.h, box.h);
  const next = rng(seed);
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < TRIES; i++) {
    const r = { x: Math.round(next() * (box.w - w)), y: Math.round(next() * (box.h - h)), w, h };
    const area = taken.reduce((n, t) => n + overlapArea(r, t), 0);
    if (area === 0) return { ...r, clear: true };
    if (area < bestArea) [best, bestArea] = [r, area];
  }
  return { ...best!, clear: false };
}
