import type { DB } from './db.js';

export type SettingsRepo = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

export function createSettingsRepo(db: DB): SettingsRepo {
  const select = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?');
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  return {
    get(key) {
      const row = select.get(key);
      return row ? row.value : null;
    },
    set(key, value) {
      upsert.run(key, value);
    },
  };
}
