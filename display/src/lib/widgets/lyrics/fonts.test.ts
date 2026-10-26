import { describe, it, expect } from 'vitest';
import { FONT_MOODS, moodFaces, pickFace, faceCss } from './fonts';

describe('font moods', () => {
  it('has the five approved moods', () => {
    expect(Object.keys(FONT_MOODS)).toEqual(['editorial', 'gig', 'handwritten', 'retro', 'mixtape']);
  });

  it('returns null for the scene font and unknown moods', () => {
    expect(moodFaces('scene')).toBeNull();
    expect(moodFaces('nope')).toBeNull();
    expect(moodFaces(undefined)).toBeNull();
  });

  it('mixtape draws from every other mood', () => {
    const families = new Set(moodFaces('mixtape')!.map((f) => f.family));
    for (const mood of ['editorial', 'gig', 'handwritten', 'retro'] as const) {
      for (const f of FONT_MOODS[mood]) expect(families.has(f.family)).toBe(true);
    }
  });
});

describe('pickFace', () => {
  const faces = moodFaces('retro')!;

  it('is deterministic for the same seed', () => {
    expect(pickFace(faces, 'we were gold', 4)).toBe(pickFace(faces, 'we were gold', 4));
  });

  it('never puts a short-words-only face on long text', () => {
    for (let i = 0; i < 200; i++) {
      expect(pickFace(faces, `seed ${i}`, 20).shortOnly).toBeFalsy();
    }
  });

  it('uses every face across many seeds', () => {
    const seen = new Set(Array.from({ length: 300 }, (_, i) => pickFace(faces, `s${i}`, 3).family));
    expect(seen.size).toBe(faces.length);
  });
});

describe('faceCss', () => {
  it('emits family, weight, style, case and tilt', () => {
    const css = faceCss({ family: 'Permanent Marker', weight: 400, tilt: -3, upper: true, italic: true });
    expect(css).toContain("font-family: 'Permanent Marker'");
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-style: italic');
    expect(css).toContain('text-transform: uppercase');
    expect(css).toContain('rotate: -3deg');
  });
});
