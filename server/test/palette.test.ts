import { describe, it, expect } from 'vitest';
import { reducePalette } from '../src/scenes/palette.js';

describe('reducePalette', () => {
  it('returns empty when no contributions', () => {
    expect(reducePalette(new Map(), ['#111111', '#222222', '#333333'], 3)).toEqual([]);
  });

  it('returns single contribution unchanged when distinct enough', () => {
    const contribs = new Map([['w1', ['#ff0000', '#00ff00', '#0000ff']]]);
    expect(reducePalette(contribs, ['#000000'], 3)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });

  it('unions contributions across widgets and dedupes near-duplicates', () => {
    const contribs = new Map([
      ['w1', ['#ff0000', '#ff0202']],
      ['w2', ['#00ff00']],
    ]);
    const out = reducePalette(contribs, ['#000000'], 3);
    expect(out.length).toBeLessThanOrEqual(3);
    const reds = out.filter((c) => c.startsWith('#ff'));
    expect(reds.length).toBe(1);
    expect(out).toContain('#00ff00');
  });

  it('pads from fallback when fewer distinct than targetCount', () => {
    const contribs = new Map([['w1', ['#ff0000']]]);
    const out = reducePalette(contribs, ['#aaaaaa', '#bbbbbb', '#cccccc'], 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('#ff0000');
    expect(out.slice(1)).toEqual(['#aaaaaa', '#bbbbbb']);
  });

  it('orders by total occurrence frequency across contributors', () => {
    const contribs = new Map([
      ['w1', ['#ff0000', '#00ff00']],
      ['w2', ['#00ff00']],
      ['w3', ['#0000ff']],
    ]);
    const out = reducePalette(contribs, ['#000000'], 3);
    expect(out[0]).toBe('#00ff00');
  });

  it('ignores empty contributor entries', () => {
    const contribs = new Map([
      ['w1', []],
      ['w2', ['#ff0000']],
    ]);
    expect(reducePalette(contribs, ['#000000'], 3)).toContain('#ff0000');
  });
});
