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
    expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
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
    expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
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

  it('migration v12 applies cleanly over a v11 database that already has cache rows', () => {
    // Simulate an existing install: build a v11-shaped DB by hand (v11 never
    // had `artist`/`title` on music_video_cache), put a row in, mark
    // versions 1-11 applied, then run the real migration chain over it.
    const legacy = new Database(':memory:');
    legacy.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    legacy.exec(`CREATE TABLE music_video_cache (
      track_key TEXT PRIMARY KEY, video_id TEXT, miss INTEGER NOT NULL DEFAULT 0, resolved_at INTEGER NOT NULL);`);
    legacy.prepare('INSERT INTO music_video_cache (track_key, video_id, miss, resolved_at) VALUES (?,?,?,?)')
      .run('legacy|track', 'zzz99999999', 0, 5);
    for (let v = 1; v <= 11; v++) legacy.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v);

    runMigrations(legacy);

    const cols = (legacy.prepare('PRAGMA table_info(music_video_cache)').all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).toContain('artist');
    expect(cols).toContain('title');

    const row = legacy.prepare('SELECT * FROM music_video_cache WHERE track_key = ?').get('legacy|track') as Record<string, unknown>;
    // The pre-existing row survived intact.
    expect(row.video_id).toBe('zzz99999999');
    expect(row.miss).toBe(0);
    expect(row.resolved_at).toBe(5);
    // Pre-v12 rows have no display names; the History list falls back to the key.
    expect(row.artist).toBeNull();
    expect(row.title).toBeNull();
  });
});
