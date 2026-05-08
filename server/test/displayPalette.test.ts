import { describe, it, expect, beforeEach } from 'vitest';
import { createDisplayPaletteStore, type DisplayPaletteStore } from '../src/store/displayPalette.js';

describe('displayPalette', () => {
  let store: DisplayPaletteStore;
  beforeEach(() => {
    store = createDisplayPaletteStore();
  });

  it('starts empty', () => {
    expect(store.getResolved('d1')).toEqual({ colors: [], updatedAt: null });
  });

  it('set returns resolvedChanged=true on first contribution', () => {
    const r = store.set('d1', 'w1', ['#ff0000', '#00ff00', '#0000ff']);
    expect(r.resolvedChanged).toBe(true);
    expect(store.getResolved('d1').colors.length).toBeGreaterThan(0);
  });

  it('set returns resolvedChanged=false on a no-op write', () => {
    store.set('d1', 'w1', ['#ff0000']);
    const r = store.set('d1', 'w1', ['#ff0000']);
    expect(r.resolvedChanged).toBe(false);
  });

  it('set returns resolvedChanged=true when a different widget updates the resolved set', () => {
    store.set('d1', 'w1', ['#ff0000']);
    const r = store.set('d1', 'w2', ['#00ff00']);
    expect(r.resolvedChanged).toBe(true);
  });

  it('empty colors clears the widget slot and may shrink the resolved set', () => {
    store.set('d1', 'w1', ['#ff0000']);
    store.set('d1', 'w2', ['#00ff00']);
    const r = store.set('d1', 'w1', []);
    expect(r.resolvedChanged).toBe(true);
    expect(store.getResolved('d1').colors).not.toContain('#ff0000');
  });

  it('clearDisplay drops every contribution for that display', () => {
    store.set('d1', 'w1', ['#ff0000']);
    store.set('d2', 'w1', ['#00ff00']);
    store.clearDisplay('d1');
    expect(store.getResolved('d1').colors).toEqual([]);
    expect(store.getResolved('d2').colors.length).toBeGreaterThan(0);
  });

  it('pruneWidgets keeps only listed widget ids', () => {
    store.set('d1', 'w1', ['#ff0000']);
    store.set('d1', 'w2', ['#00ff00']);
    store.pruneWidgets('d1', new Set(['w2']));
    const colors = store.getResolved('d1').colors;
    expect(colors).not.toContain('#ff0000');
    expect(colors).toContain('#00ff00');
  });

  it('updatedAt advances on each successful change', async () => {
    store.set('d1', 'w1', ['#ff0000']);
    const t1 = store.getResolved('d1').updatedAt;
    expect(t1).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    store.set('d1', 'w2', ['#00ff00']);
    const t2 = store.getResolved('d1').updatedAt;
    expect(t2 === null ? 0 : Date.parse(t2)).toBeGreaterThan(t1 === null ? 0 : Date.parse(t1));
  });

  it('getContributions returns a defensive copy of the raw map', () => {
    store.set('d1', 'w1', ['#ff0000']);
    store.set('d1', 'w2', ['#00ff00']);
    const c = store.getContributions('d1');
    expect(c.get('w1')).toEqual(['#ff0000']);
    expect(c.get('w2')).toEqual(['#00ff00']);
    // Mutation of the returned map does not affect store state.
    c.delete('w1');
    expect(store.getContributions('d1').size).toBe(2);
  });

  it('getContributions returns empty map for unknown display', () => {
    expect(store.getContributions('nope').size).toBe(0);
  });
});
