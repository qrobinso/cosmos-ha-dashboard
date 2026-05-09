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
    expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('migration v3 adds transitions, scene_transition_overrides, and scenes.default_transition_id', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('transitions');
    expect(names).toContain('scene_transition_overrides');

    const sceneCols = db.prepare("PRAGMA table_info('scenes')").all() as { name: string }[];
    expect(sceneCols.map((c) => c.name)).toContain('default_transition_id');

    const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[];
    expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('migration v3 seeds the 6 built-in transitions', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const rows = db.prepare('SELECT name FROM transitions WHERE builtin = 1 ORDER BY name').all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(['cross-fade', 'dissolve', 'gradient-morph', 'scale-fade', 'slide-down', 'slide-up']);
  });

  it('migration v7 adds mood_json with a disabled-manual default', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const cols = db.prepare("PRAGMA table_info('scenes')").all() as { name: string; dflt_value: string | null }[];
    const mood = cols.find((c) => c.name === 'mood_json');
    expect(mood).toBeTruthy();
    expect(mood?.dflt_value).toContain('"enabled":false');
  });
});
