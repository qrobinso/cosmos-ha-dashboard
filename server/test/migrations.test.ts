import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';

describe('runMigrations', () => {
  it('creates all tables on a fresh database', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('displays');
    expect(names).toContain('settings');
    expect(names).toContain('schema_version');
    expect(names).toContain('scenes');
    expect(names).toContain('widgets');
    expect(names).toContain('scenes_displays');
  });

  it('adds default_scene_id and current_scene_id columns to displays', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const cols = db
      .prepare("PRAGMA table_info('displays')")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain('default_scene_id');
    expect(names).toContain('current_scene_id');
  });

  it('records both migration versions and is idempotent', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db);
    const versions = db
      .prepare('SELECT version FROM schema_version ORDER BY version')
      .all() as { version: number }[];
    expect(versions.map((r) => r.version)).toEqual([1, 2]);
  });
});
