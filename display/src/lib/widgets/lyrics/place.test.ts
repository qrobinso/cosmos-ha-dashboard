import { describe, it, expect } from 'vitest';
import { placeLine, overlaps, type Rect } from './place';

const BOX = { w: 1000, h: 600 };
const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= BOX.w && r.y + r.h <= BOX.h;

describe('placeLine', () => {
  it('stays inside the box', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(inside(placeLine({ w: 300, h: 80 }, BOX, [], seed))).toBe(true);
    }
  });

  it('avoids lines already floating when there is room', () => {
    const taken: Rect[] = [{ x: 0, y: 0, w: 1000, h: 250 }, { x: 0, y: 250, w: 500, h: 350 }];
    for (let seed = 0; seed < 50; seed++) {
      const r = placeLine({ w: 300, h: 80 }, BOX, taken, seed);
      expect(inside(r)).toBe(true);
      for (const t of taken) expect(overlaps(r, t)).toBe(false);
      expect(r.clear).toBe(true);
    }
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const a = placeLine({ w: 200, h: 60 }, BOX, [], 7);
    expect(placeLine({ w: 200, h: 60 }, BOX, [], 7)).toEqual(a);
    const spots = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(placeLine({ w: 200, h: 60 }, BOX, [], s))));
    expect(spots.size).toBeGreaterThan(10);
  });

  it('still returns an in-bounds spot when nothing fits', () => {
    const r = placeLine({ w: 300, h: 80 }, BOX, [{ x: 0, y: 0, w: 1000, h: 600 }], 3);
    expect(inside(r)).toBe(true);
    expect(r.clear).toBe(false);
  });

  it('clamps a line wider than the box to the box', () => {
    const r = placeLine({ w: 1400, h: 80 }, BOX, [], 1);
    expect(r.x).toBe(0);
    expect(inside({ ...r, w: Math.min(r.w, BOX.w) })).toBe(true);
  });
});
