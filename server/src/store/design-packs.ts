import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './db.js';

export type DesignPackSource = 'builtin' | 'user';

export type DesignPack = {
  id: string;
  slug: string;
  name: string;
  content: string;
  source: DesignPackSource;
  created_at: string;
  updated_at: string;
};

export type DesignPackInput = {
  slug: string;
  name: string;
  content: string;
  source: DesignPackSource;
};

export type DesignPacksRepo = {
  list(): DesignPack[];
  get(id: string): DesignPack | null;
  getBySlug(slug: string): DesignPack | null;
  create(input: DesignPackInput): DesignPack;
  update(id: string, patch: { name?: string; content?: string }): DesignPack;
  delete(id: string): void;
  /** Read every `.md` file in `dir` and upsert each as a builtin row. The
   *  filename stem (without `.md`) is the slug. The first H1 in the file
   *  becomes the name, falling back to a title-cased slug. User-authored
   *  rows with the same slug are left untouched. */
  seedBuiltinsFromDir(dir: string): void;
  /** Same as seedBuiltinsFromDir but takes an inline `slug → {name, content}`
   *  map. Exists so tests can exercise the upsert without touching disk. */
  seedBuiltinsFromMap(map: Record<string, { name: string; content: string }>): void;
};

type Row = {
  id: string;
  slug: string;
  name: string;
  content: string;
  source: string;
  created_at: string;
  updated_at: string;
};

function rowToPack(r: Row): DesignPack {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    content: r.content,
    source: r.source as DesignPackSource,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function createDesignPacksRepo(db: DB): DesignPacksRepo {
  const insert = db.prepare(
    'INSERT INTO design_packs (id, slug, name, content, source) VALUES (?, ?, ?, ?, ?)'
  );
  const updateRow = db.prepare(
    'UPDATE design_packs SET name = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  );
  const deleteRow = db.prepare('DELETE FROM design_packs WHERE id = ?');
  const selectAll = db.prepare<[], Row>(
    'SELECT id, slug, name, content, source, created_at, updated_at FROM design_packs ORDER BY name'
  );
  const selectById = db.prepare<[string], Row>(
    'SELECT id, slug, name, content, source, created_at, updated_at FROM design_packs WHERE id = ?'
  );
  const selectBySlug = db.prepare<[string], Row>(
    'SELECT id, slug, name, content, source, created_at, updated_at FROM design_packs WHERE slug = ?'
  );
  /** UPSERT for built-in seeding: only matches existing rows where source='builtin',
   *  so we never stomp a user-authored row that happens to share a slug. */
  const upsertBuiltin = db.prepare(
    `INSERT INTO design_packs (id, slug, name, content, source)
     VALUES (?, ?, ?, ?, 'builtin')
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       content = excluded.content,
       updated_at = CURRENT_TIMESTAMP
     WHERE design_packs.source = 'builtin'`
  );

  const repo: DesignPacksRepo = {
    list() {
      return selectAll.all().map(rowToPack);
    },
    get(id) {
      const r = selectById.get(id);
      return r ? rowToPack(r) : null;
    },
    getBySlug(slug) {
      const r = selectBySlug.get(slug);
      return r ? rowToPack(r) : null;
    },
    create(input) {
      const id = randomUUID();
      insert.run(id, input.slug, input.name, input.content, input.source);
      const row = selectById.get(id);
      if (!row) throw new Error('insert failed');
      return rowToPack(row);
    },
    update(id, patch) {
      const existing = selectById.get(id);
      if (!existing) throw new Error(`design pack ${id} not found`);
      const name = patch.name ?? existing.name;
      const content = patch.content ?? existing.content;
      updateRow.run(name, content, id);
      return rowToPack(selectById.get(id)!);
    },
    delete(id) {
      deleteRow.run(id);
    },
    seedBuiltinsFromDir(dir) {
      let entries: string[] = [];
      try { entries = readdirSync(dir); } catch { return; }
      const map: Record<string, { name: string; content: string }> = {};
      for (const fname of entries) {
        if (!fname.endsWith('.md')) continue;
        const slug = fname.slice(0, -3);
        const content = readFileSync(join(dir, fname), 'utf8');
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const name = titleMatch ? titleMatch[1].trim() : slug
          .split('-')
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
          .join(' ');
        map[slug] = { name, content };
      }
      repo.seedBuiltinsFromMap(map);
    },
    seedBuiltinsFromMap(map) {
      const tx = db.transaction(() => {
        for (const [slug, { name, content }] of Object.entries(map)) {
          upsertBuiltin.run(randomUUID(), slug, name, content);
        }
      });
      tx();
    },
  };

  return repo;
}
