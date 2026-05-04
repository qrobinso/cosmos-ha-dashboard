import type { DB } from './db.js';

type Migration = { version: number; up: string };

const migrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
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
