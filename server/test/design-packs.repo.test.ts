import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return createDesignPacksRepo(db);
}

const sample = {
  slug: 'quiet-luxury',
  name: 'Quiet Luxury',
  content: '---\nname: Quiet Luxury\ncolors:\n  bg: "#0d0c0a"\n---\n\nBody.',
};

describe('design_packs repo', () => {
  let repo: ReturnType<typeof createDesignPacksRepo>;
  beforeEach(() => { repo = setup(); });

  it('create + getBySlug round-trips a user pack', () => {
    const created = repo.create({ ...sample, source: 'user' });
    expect(created.slug).toBe('quiet-luxury');
    expect(created.source).toBe('user');
    expect(created.id).toBeTruthy();

    const fetched = repo.getBySlug('quiet-luxury');
    expect(fetched?.content).toBe(sample.content);
  });

  it('list returns rows in alphabetical order by name', () => {
    repo.create({ slug: 'b', name: 'Beta', content: 'b', source: 'user' });
    repo.create({ slug: 'a', name: 'Alpha', content: 'a', source: 'user' });
    expect(repo.list().map((p) => p.name)).toEqual(['Alpha', 'Beta']);
  });

  it('create rejects duplicate slugs', () => {
    repo.create({ ...sample, source: 'user' });
    expect(() => repo.create({ ...sample, source: 'user' })).toThrow();
  });

  it('update changes name and content but not slug or source', () => {
    const created = repo.create({ ...sample, source: 'user' });
    repo.update(created.id, { name: 'Renamed', content: 'new body' });
    const after = repo.get(created.id)!;
    expect(after.name).toBe('Renamed');
    expect(after.content).toBe('new body');
    expect(after.slug).toBe('quiet-luxury');
    expect(after.source).toBe('user');
  });

  it('delete removes the row', () => {
    const created = repo.create({ ...sample, source: 'user' });
    repo.delete(created.id);
    expect(repo.get(created.id)).toBeNull();
  });

  it('seedBuiltins inserts files as source=builtin and is idempotent', () => {
    repo.seedBuiltinsFromMap({
      'quiet-luxury': { name: 'Quiet Luxury', content: 'a' },
      'editorial':    { name: 'Editorial',    content: 'b' },
    });
    expect(repo.list().length).toBe(2);
    expect(repo.list().every((p) => p.source === 'builtin')).toBe(true);

    // Run again with updated content — should overwrite, not duplicate.
    repo.seedBuiltinsFromMap({
      'quiet-luxury': { name: 'Quiet Luxury', content: 'a-updated' },
      'editorial':    { name: 'Editorial',    content: 'b' },
    });
    expect(repo.list().length).toBe(2);
    expect(repo.getBySlug('quiet-luxury')?.content).toBe('a-updated');
  });

  it('seedBuiltinsFromMap does not overwrite user packs with the same slug', () => {
    repo.create({ slug: 'mine', name: 'Mine', content: 'user content', source: 'user' });
    repo.seedBuiltinsFromMap({ 'mine': { name: 'Stomp', content: 'builtin' } });
    const after = repo.getBySlug('mine')!;
    expect(after.source).toBe('user');
    expect(after.content).toBe('user content');
  });
});
