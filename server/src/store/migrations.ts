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
