import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('displays repo', () => {
  let repo: ReturnType<typeof createDisplaysRepo>;

  beforeEach(() => {
    repo = createDisplaysRepo(freshDb());
  });

  it('registerByName creates a display the first time and returns it', () => {
    const d = repo.registerByName('Living Room');
    expect(d.name).toBe('Living Room');
    expect(d.id).toMatch(/^[a-z0-9-]{8,}$/);
  });

  it('registerByName is idempotent — same name returns the same id', () => {
    const a = repo.registerByName('Kitchen');
    const b = repo.registerByName('Kitchen');
    expect(b.id).toBe(a.id);
  });

  it('list returns all displays', () => {
    repo.registerByName('A');
    repo.registerByName('B');
    expect(repo.list().map((d) => d.name).sort()).toEqual(['A', 'B']);
  });

  it('touch updates last_seen', () => {
    const d = repo.registerByName('Hallway');
    repo.touch(d.id);
    const after = repo.list().find((x) => x.id === d.id)!;
    expect(after.lastSeen).not.toBeNull();
  });
});
