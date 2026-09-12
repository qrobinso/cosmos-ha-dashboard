import { describe, it, expect } from 'vitest';
import { expandSelection } from '../src/aerials/select.js';
import type { AerialAsset } from '../src/aerials/types.js';

const A = (id: string, category: AerialAsset['category'], name = id): AerialAsset => ({
  id, name, category, previewUrl: '', sourceUrl: `https://cdn/${id}.mov`,
});
const assets = [A('E1', 'earth'), A('L1', 'landscape'), A('L2', 'landscape'), A('C1', 'city'), A('S1', 'sea')];

describe('expandSelection', () => {
  it('expands whole categories in catalog order, then appends individual picks', () => {
    const out = expandSelection({ ids: ['S1', 'E1'], categories: ['landscape'] }, assets);
    expect(out.map((a) => a.id)).toEqual(['L1', 'L2', 'S1', 'E1']);
  });

  it('de-duplicates a pick already implied by its category and drops unknown ids', () => {
    const out = expandSelection({ ids: ['L2', 'NOPE'], categories: ['landscape'] }, assets);
    expect(out.map((a) => a.id)).toEqual(['L1', 'L2']);
  });

  it('returns [] for an empty selection or empty catalog', () => {
    expect(expandSelection({ ids: [] }, assets)).toEqual([]);
    expect(expandSelection({ ids: ['E1'], categories: ['sea'] }, [])).toEqual([]);
  });
});
