import type { DB } from './db.js';

type Migration = { version: number; up: string };

const migrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS displays (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        last_seen TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        layout_json TEXT NOT NULL,
        background_json TEXT NOT NULL,
        typography_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS widgets (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        position_json TEXT NOT NULL,
        config_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_widgets_scene ON widgets(scene_id);
      CREATE TABLE IF NOT EXISTS scenes_displays (
        scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
        display_id TEXT NOT NULL REFERENCES displays(id) ON DELETE CASCADE,
        PRIMARY KEY (scene_id, display_id)
      );
      ALTER TABLE displays ADD COLUMN default_scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL;
      ALTER TABLE displays ADD COLUMN current_scene_id TEXT REFERENCES scenes(id) ON DELETE SET NULL;
    `,
  },
  {
    version: 3,
    up: `
      CREATE TABLE IF NOT EXISTS transitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        descriptor_json TEXT NOT NULL,
        builtin INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS scene_transition_overrides (
        from_scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
        to_scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
        transition_id TEXT NOT NULL REFERENCES transitions(id) ON DELETE CASCADE,
        PRIMARY KEY (from_scene_id, to_scene_id)
      );
      ALTER TABLE scenes ADD COLUMN default_transition_id TEXT REFERENCES transitions(id) ON DELETE SET NULL;

      INSERT OR IGNORE INTO transitions (id, name, descriptor_json, builtin) VALUES
        ('builtin-cross-fade', 'cross-fade',
          '{"id":"builtin-cross-fade","name":"cross-fade","out":{"keyframes":"cosmos-out-fade","duration_ms":300,"easing":"ease"},"bridge":{"background_morph":false},"in":{"keyframes":"cosmos-in-fade","duration_ms":300,"easing":"ease"}}',
          1),
        ('builtin-scale-fade', 'scale-fade',
          '{"id":"builtin-scale-fade","name":"scale-fade","out":{"keyframes":"cosmos-out-scale-fade","duration_ms":350,"easing":"ease-in"},"bridge":{"background_morph":false},"in":{"keyframes":"cosmos-in-scale-fade","duration_ms":350,"easing":"ease-out"}}',
          1),
        ('builtin-slide-up', 'slide-up',
          '{"id":"builtin-slide-up","name":"slide-up","out":{"keyframes":"cosmos-out-slide-up","duration_ms":400,"easing":"ease-in"},"bridge":{"background_morph":false},"in":{"keyframes":"cosmos-in-slide-up","duration_ms":400,"easing":"ease-out"}}',
          1),
        ('builtin-slide-down', 'slide-down',
          '{"id":"builtin-slide-down","name":"slide-down","out":{"keyframes":"cosmos-out-slide-down","duration_ms":400,"easing":"ease-in"},"bridge":{"background_morph":false},"in":{"keyframes":"cosmos-in-slide-down","duration_ms":400,"easing":"ease-out"}}',
          1),
        ('builtin-dissolve', 'dissolve',
          '{"id":"builtin-dissolve","name":"dissolve","out":{"keyframes":"cosmos-out-dissolve","duration_ms":500,"easing":"ease","stagger_ms":40},"bridge":{"background_morph":false},"in":{"keyframes":"cosmos-in-dissolve","duration_ms":500,"easing":"ease","stagger_ms":40}}',
          1),
        ('builtin-gradient-morph', 'gradient-morph',
          '{"id":"builtin-gradient-morph","name":"gradient-morph","out":{"keyframes":"cosmos-out-fade","duration_ms":600,"easing":"ease"},"bridge":{"background_morph":true},"in":{"keyframes":"cosmos-in-fade","duration_ms":600,"easing":"ease"}}',
          1);
    `,
  },
];

export function runMigrations(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
  const applied = db.prepare('SELECT version FROM schema_version').all() as { version: number }[];
  const appliedSet = new Set(applied.map((r) => r.version));
  const insert = db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)');
  for (const m of migrations) {
    if (appliedSet.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.up);
      insert.run(m.version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
