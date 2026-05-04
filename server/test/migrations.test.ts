import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';

describe('runMigrations', () => {
  it('creates displays and settings tables on a fresh database', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('displays');
    expect(names).toContain('settings');
    expect(names).toContain('schema_version');
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db);
    const version = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(version.v).toBe(1);
  });
});
