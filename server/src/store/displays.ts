import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export type Display = {
  id: string;
  name: string;
  lastSeen: string | null;
};

export type DisplaysRepo = {
  registerByName(name: string): Display;
  list(): Display[];
  touch(id: string): void;
  getByName(name: string): Display | null;
};

type Row = { id: string; name: string; last_seen: string | null };

function rowToDisplay(r: Row): Display {
  return { id: r.id, name: r.name, lastSeen: r.last_seen };
}

export function createDisplaysRepo(db: DB): DisplaysRepo {
  const selectByName = db.prepare<[string], Row>('SELECT id, name, last_seen FROM displays WHERE name = ?');
  const insert = db.prepare('INSERT INTO displays (id, name) VALUES (?, ?)');
  const selectAll = db.prepare<[], Row>('SELECT id, name, last_seen FROM displays ORDER BY name');
  const updateLastSeen = db.prepare('UPDATE displays SET last_seen = CURRENT_TIMESTAMP WHERE id = ?');

  return {
    registerByName(name) {
      const existing = selectByName.get(name);
      if (existing) return rowToDisplay(existing);
      const id = randomUUID();
      insert.run(id, name);
      return rowToDisplay(selectByName.get(name)!);
    },
    list() {
      return selectAll.all().map(rowToDisplay);
    },
    touch(id) {
      updateLastSeen.run(id);
    },
    getByName(name) {
      const r = selectByName.get(name);
      return r ? rowToDisplay(r) : null;
    },
  };
}
