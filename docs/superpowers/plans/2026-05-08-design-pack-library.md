# Design Pack Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a library of DESIGN.md-spec packs that the in-product agent and external MCP agents pull from to produce visually consistent canvases.

**Architecture:** Built-in packs live as `.md` files in `server/src/designs/builtins/` and are upserted into a new SQLite `design_packs` table at boot. Users / MCP agents create additional packs that persist as `source='user'` rows. The admin chat composer gets a sticky dropdown that sends the chosen slug in the chat request body; the system prompt builder appends the pack content as a fourth section after the contracts. External MCP agents reach the same packs through new resources (`cosmos://designs`, `cosmos://designs/<slug>`) and tools (`list_designs`, `get_design`, `create_design`, `update_design`).

**Tech Stack:** TypeScript, Fastify, better-sqlite3, vitest, Svelte 4 (display), `js-yaml` (new dep), Vercel AI SDK (already wired).

Spec: [docs/superpowers/specs/2026-05-08-design-pack-library-design.md](docs/superpowers/specs/2026-05-08-design-pack-library-design.md). Refer to it for the full feature rationale; this plan only repeats schema details where the implementer needs them inline.

---

## Task 1: DESIGN.md parser

**Files:**
- Create: `server/src/designs/parse.ts`
- Create: `server/test/designs.parse.test.ts`
- Modify: `server/package.json` (add `js-yaml` + `@types/js-yaml`)

- [ ] **Step 1: Add js-yaml dependency**

Run from repo root:

```
npm --workspace server install js-yaml@^4.1.0
npm --workspace server install --save-dev @types/js-yaml@^4.0.9
```

Expected: `server/package.json` gains both entries; `package-lock.json` updates.

- [ ] **Step 2: Write the failing parser test**

Create `server/test/designs.parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDesignPack } from '../src/designs/parse.js';

describe('parseDesignPack', () => {
  it('splits a well-formed file into frontmatter and body', () => {
    const raw = [
      '---',
      'name: Quiet Luxury',
      'colors:',
      '  bg: "#0d0c0a"',
      '  accent: "#c8b896"',
      '---',
      '',
      '# Quiet Luxury',
      '',
      'Calm, warm, minimal.',
    ].join('\n');
    const r = parseDesignPack(raw);
    expect(r.frontmatter).toEqual({
      name: 'Quiet Luxury',
      colors: { bg: '#0d0c0a', accent: '#c8b896' },
    });
    expect(r.body.trim().startsWith('# Quiet Luxury')).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('treats a file with no frontmatter as body-only', () => {
    const raw = '# Just a title\n\nBody text only.';
    const r = parseDesignPack(raw);
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe(raw);
    expect(r.errors).toEqual([]);
  });

  it('returns an error for malformed YAML and treats body as the rest', () => {
    const raw = '---\ncolors: {bg: "#0d0c0a"\n---\n\nBody after broken yaml.';
    const r = parseDesignPack(raw);
    expect(r.frontmatter).toEqual({});
    expect(r.body.trim()).toBe('Body after broken yaml.');
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/yaml/i);
  });

  it('handles a file with only frontmatter and no body', () => {
    const raw = '---\nname: Skeleton\n---\n';
    const r = parseDesignPack(raw);
    expect(r.frontmatter).toEqual({ name: 'Skeleton' });
    expect(r.body).toBe('');
    expect(r.errors).toEqual([]);
  });

  it('exposes the four-color preview helper', async () => {
    const { previewFromFrontmatter } = await import('../src/designs/parse.js');
    const fm = {
      colors: { bg: '#0d0c0a', surface: '#3b342c', accent: '#c8b896', text: '#f3ecd8', extra: '#ffffff' },
      typography: { body: { fontFamily: 'Inter' } },
    };
    expect(previewFromFrontmatter(fm)).toEqual({
      colors: ['#0d0c0a', '#3b342c', '#c8b896', '#f3ecd8'],
      font_family: 'Inter',
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run designs.parse --pool=forks --poolOptions.forks.singleFork`
Expected: FAIL — `parseDesignPack` not defined.

- [ ] **Step 4: Implement the parser**

Create `server/src/designs/parse.ts`:

```ts
import { load as loadYaml, YAMLException } from 'js-yaml';

export type ParsedDesignPack = {
  /** YAML frontmatter object. `{}` when missing or unparseable. */
  frontmatter: Record<string, unknown>;
  /** Raw markdown body (everything after the closing `---`, or the whole
   *  file if there's no frontmatter block). */
  body: string;
  /** Non-fatal warnings — YAML parse errors land here so the API can still
   *  return the body but the caller knows the frontmatter was dropped. */
  errors: string[];
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseDesignPack(raw: string): ParsedDesignPack {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) {
    return { frontmatter: {}, body: raw, errors: [] };
  }
  const [, yamlBlock, body] = m;
  try {
    const parsed = loadYaml(yamlBlock);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { frontmatter: {}, body, errors: ['frontmatter must be a YAML object'] };
    }
    return { frontmatter: parsed as Record<string, unknown>, body, errors: [] };
  } catch (err) {
    const msg = err instanceof YAMLException ? `yaml: ${err.message}` : 'yaml: parse failed';
    return { frontmatter: {}, body, errors: [msg] };
  }
}

/** Project a parsed frontmatter into the small shape the admin dropdown
 *  + MCP `list_designs` uses for previews. Returns the first 4 hex values
 *  encountered in `colors` (depth-1) and `typography.body.fontFamily` if
 *  present. Designed to be tolerant: any missing piece resolves to a safe
 *  default rather than an error. */
export function previewFromFrontmatter(
  fm: Record<string, unknown>
): { colors: string[]; font_family: string | null } {
  const colors: string[] = [];
  const fmColors = fm.colors;
  if (fmColors && typeof fmColors === 'object' && !Array.isArray(fmColors)) {
    for (const v of Object.values(fmColors as Record<string, unknown>)) {
      if (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) {
        colors.push(v.trim());
        if (colors.length === 4) break;
      }
    }
  }
  let font_family: string | null = null;
  const typo = fm.typography;
  if (typo && typeof typo === 'object' && !Array.isArray(typo)) {
    const body = (typo as Record<string, unknown>).body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const ff = (body as Record<string, unknown>).fontFamily;
      if (typeof ff === 'string' && ff.trim() !== '') font_family = ff.trim();
    }
  }
  return { colors, font_family };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run designs.parse --pool=forks --poolOptions.forks.singleFork`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```
git add server/src/designs/parse.ts server/test/designs.parse.test.ts server/package.json package-lock.json
git commit -m "feat(designs): DESIGN.md parser + preview projection"
```

---

## Task 2: SQLite migration v9 (`design_packs` table)

**Files:**
- Modify: `server/src/store/migrations.ts` (append migration v9)
- Test: covered by Task 3 repo tests (the migration is exercised through `runMigrations(db)` in `setup()`)

- [ ] **Step 1: Append the migration**

Open `server/src/store/migrations.ts`. The current file ends with the `version: 8` entry at line ~144 (the `transitions` UPSERT). Append a new entry to the `MIGRATIONS` array immediately after the `version: 8` entry, before the closing `];`:

```ts
  {
    /**
     * Adds the `design_packs` table — small library of DESIGN.md-spec
     * markdown files (Google Labs design.md format). Built-ins are upserted
     * from `server/src/designs/builtins/` on every server boot, so addon
     * updates can ship updated built-ins. User/MCP-authored packs persist
     * as `source='user'` and are protected from the upsert. Slug is the
     * stable identifier used by the system prompt and MCP resources.
     */
    version: 9,
    up: `
      CREATE TABLE design_packs (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('builtin','user')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX design_packs_slug_idx ON design_packs (slug);
    `,
  },
```

- [ ] **Step 2: Verify the migration applies cleanly**

Run: `cd server && npx vitest run migrations --pool=forks --poolOptions.forks.singleFork`
Expected: PASS (existing migration tests should still pass; nothing exercises v9 yet — Task 3 will).

- [ ] **Step 3: Commit**

```
git add server/src/store/migrations.ts
git commit -m "feat(store): migration v9 — design_packs table"
```

---

## Task 3: Design packs repo

**Files:**
- Create: `server/src/store/design-packs.ts`
- Create: `server/test/design-packs.repo.test.ts`

- [ ] **Step 1: Write the failing repo tests**

Create `server/test/design-packs.repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return createDesignPacksRepo(db);
}

const sample = {
  slug: 'quiet-luxury',
  name: 'Quiet Luxury',
  content: '---\nname: Quiet Luxury\ncolors:\n  bg: "#0d0c0a"\n---\n\nBody.',
};

describe('design_packs repo', () => {
  let repo: ReturnType<typeof createDesignPacksRepo>;
  beforeEach(() => { repo = setup(); });

  it('create + getBySlug round-trips a user pack', () => {
    const created = repo.create({ ...sample, source: 'user' });
    expect(created.slug).toBe('quiet-luxury');
    expect(created.source).toBe('user');
    expect(created.id).toBeTruthy();

    const fetched = repo.getBySlug('quiet-luxury');
    expect(fetched?.content).toBe(sample.content);
  });

  it('list returns rows in alphabetical order by name', () => {
    repo.create({ slug: 'b', name: 'Beta', content: 'b', source: 'user' });
    repo.create({ slug: 'a', name: 'Alpha', content: 'a', source: 'user' });
    expect(repo.list().map((p) => p.name)).toEqual(['Alpha', 'Beta']);
  });

  it('create rejects duplicate slugs', () => {
    repo.create({ ...sample, source: 'user' });
    expect(() => repo.create({ ...sample, source: 'user' })).toThrow();
  });

  it('update changes name and content but not slug or source', () => {
    const created = repo.create({ ...sample, source: 'user' });
    repo.update(created.id, { name: 'Renamed', content: 'new body' });
    const after = repo.get(created.id)!;
    expect(after.name).toBe('Renamed');
    expect(after.content).toBe('new body');
    expect(after.slug).toBe('quiet-luxury');
    expect(after.source).toBe('user');
  });

  it('delete removes the row', () => {
    const created = repo.create({ ...sample, source: 'user' });
    repo.delete(created.id);
    expect(repo.get(created.id)).toBeNull();
  });

  it('seedBuiltins inserts files as source=builtin and is idempotent', () => {
    // Stub the filesystem read by passing files inline.
    repo.seedBuiltinsFromMap({
      'quiet-luxury': { name: 'Quiet Luxury', content: 'a' },
      'editorial':    { name: 'Editorial',    content: 'b' },
    });
    expect(repo.list().length).toBe(2);
    expect(repo.list().every((p) => p.source === 'builtin')).toBe(true);

    // Run again with updated content — should overwrite, not duplicate.
    repo.seedBuiltinsFromMap({
      'quiet-luxury': { name: 'Quiet Luxury', content: 'a-updated' },
      'editorial':    { name: 'Editorial',    content: 'b' },
    });
    expect(repo.list().length).toBe(2);
    expect(repo.getBySlug('quiet-luxury')?.content).toBe('a-updated');
  });

  it('seedBuiltinsFromMap does not overwrite user packs with the same slug', () => {
    repo.create({ slug: 'mine', name: 'Mine', content: 'user content', source: 'user' });
    repo.seedBuiltinsFromMap({ 'mine': { name: 'Stomp', content: 'builtin' } });
    const after = repo.getBySlug('mine')!;
    expect(after.source).toBe('user');
    expect(after.content).toBe('user content');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run design-packs.repo --pool=forks --poolOptions.forks.singleFork`
Expected: FAIL — `createDesignPacksRepo` not defined.

- [ ] **Step 3: Implement the repo**

Create `server/src/store/design-packs.ts`:

```ts
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

  return {
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
      this.seedBuiltinsFromMap(map);
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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run design-packs.repo --pool=forks --poolOptions.forks.singleFork`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```
git add server/src/store/design-packs.ts server/test/design-packs.repo.test.ts
git commit -m "feat(store): design packs repo with builtin upsert"
```

---

## Task 4: Built-in pack files

**Files:**
- Create: `server/src/designs/builtins/quiet-luxury.md`
- Create: `server/src/designs/builtins/editorial.md`
- Create: `server/src/designs/builtins/neo-brutalist.md`
- Create: `server/src/designs/builtins/soft-ambient.md`
- Modify: `server/tsconfig.json` if needed to include `src/designs/builtins/**/*.md` as assets — see Step 5 verification.

- [ ] **Step 1: Write `quiet-luxury.md`**

Create `server/src/designs/builtins/quiet-luxury.md`:

```md
---
name: Quiet Luxury
description: Calm, generous whitespace, warm muted palette.
colors:
  bg: "#0d0c0a"
  surface: "#3b342c"
  accent: "#c8b896"
  text: "#f3ecd8"
  muted: "#8a7d6b"
typography:
  display:
    fontFamily: Fraunces
    fontWeight: 500
    letterSpacing: "-0.01em"
  body:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 18px
    lineHeight: 1.6
rounded:
  sm: 4px
  md: 8px
  lg: 16px
spacing:
  xs: 8px
  sm: 16px
  md: 32px
  lg: 64px
  xl: 128px
---

# Quiet Luxury

Calm before content. The wall display reads like a single thought, not a screen
of stuff.

## Overview

This pack leans into space. Warm neutrals, a single champagne accent, generous
breathing room. No hard borders, no chrome, no gradients except the subtlest
of tonal shifts. The reader's eye should land on one focal element with nothing
fighting for attention beside it.

## Colors

- `bg` is a warm near-black — it should never read as cold or "tech".
- `surface` is a dusty taupe used sparingly for cards or pulled-out sections.
- `accent` is the only chromatic note — use for one element per scene at most.
- `text` is a cream, never pure white.

## Typography

Fraunces for hero numerals and display text — its optical sizing carries weight
at room distance. Inter for everything else. Body sizing is generous: 18px+
default. Hero numerals can go to 8rem without feeling shouty because the
palette stays so quiet.

## Layout

- One focal element per scene.
- Safe-area padding ≥ 10% of the shorter dimension.
- Center-aligned by default; flush-left only when the content is genuinely list-shaped.

## Don't

- Don't add borders or shadows.
- Don't use more than three active colors in a single canvas.
- Don't stack four or more text sizes — two is usually enough.
```

- [ ] **Step 2: Write `editorial.md`**

Create `server/src/designs/builtins/editorial.md`:

```md
---
name: Editorial
description: Magazine-cover energy. Big serif type, single warm accent.
colors:
  bg: "#fafaf7"
  text: "#0a0a0a"
  surface: "#ebe7df"
  accent: "#c0392b"
  muted: "#5a5a5a"
typography:
  display:
    fontFamily: Fraunces
    fontWeight: 700
    letterSpacing: "-0.02em"
  body:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 16px
    lineHeight: 1.55
rounded:
  sm: 0px
  md: 0px
  lg: 0px
spacing:
  xs: 4px
  sm: 12px
  md: 24px
  lg: 48px
  xl: 96px
---

# Editorial

Treat the wall like a magazine cover. The biggest thing on screen should be
type, not data.

## Overview

High-contrast, paper-bright, with one warm accent. Type drives the hierarchy:
display sizes are deliberately huge (think 6–10rem for the hero), body copy
stays small and well-leaded. No rounded corners. Single column dominant.

## Colors

- `bg` is paper, not white — slightly warm.
- `text` is ink, near-pure black.
- `accent` is a warm red, used as a typographic flourish (a number, a single
  word) — never as a fill.

## Typography

Fraunces (or Playfair if available) at display sizes carries the weight. Inter
small for body. Maintain at least 4× scale ratio between display and body.

## Layout

- Strong vertical rhythm; baseline-grid feel.
- Use whitespace as a structural element — not as filler.
- One image or canvas anchor per scene.

## Don't

- Don't soften with rounded corners. Editorial respects the rectangle.
- Don't dilute the palette — three colors max.
- Don't centre body copy. Centring is for display elements only.
```

- [ ] **Step 3: Write `neo-brutalist.md`**

Create `server/src/designs/builtins/neo-brutalist.md`:

```md
---
name: Neo-Brutalist
description: High contrast, blocky, no rounding, mono everywhere.
colors:
  bg: "#ffffff"
  text: "#000000"
  surface: "#f0f0f0"
  accent: "#0033ff"
  warning: "#ff3300"
typography:
  display:
    fontFamily: JetBrains Mono
    fontWeight: 700
    letterSpacing: "0em"
  body:
    fontFamily: JetBrains Mono
    fontWeight: 400
    fontSize: 14px
    lineHeight: 1.4
rounded:
  sm: 0px
  md: 0px
  lg: 0px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 32px
  xl: 64px
---

# Neo-Brutalist

Information density without apology. Every pixel is utilitarian.

## Overview

Pure white background, pure black ink, single saturated accent (electric blue).
Mono everywhere — labels, numbers, headers. No anti-aliased curves anywhere
visible to the user; no rounded corners; no shadows except a single 4px
hard-edged offset when separation is genuinely needed.

## Colors

- `bg` and `text` are pure (#ffffff / #000000) — no off-tones.
- `accent` is electric blue — use freely as fills, dividers, highlights.
- `warning` is reserved for genuinely urgent state (alerts, errors).

## Typography

JetBrains Mono everywhere. Body 14px, display starts at 32px and scales by
factors of 2 (32 → 64 → 128). Use `font-weight: 700` for headers and large
numerals, `400` for body.

## Layout

- Hard 4px or 8px gridlines.
- Stack information densely; let the user scan rather than meditate.
- Borders are 2px solid black where used.

## Don't

- Don't soften any edge.
- Don't blur, fade, or gradient anything.
- Don't centre body content; left-align everything.
```

- [ ] **Step 4: Write `soft-ambient.md`**

Create `server/src/designs/builtins/soft-ambient.md`:

```md
---
name: Soft Ambient
description: Low contrast, mood-video-friendly. Designed to overlay translucent video.
colors:
  bg: "transparent"
  surface: "rgba(255,255,255,0.08)"
  accent: "#e7c2c8"
  text: "#f6f1ee"
  muted: "rgba(246,241,238,0.6)"
typography:
  display:
    fontFamily: Inter
    fontWeight: 300
    letterSpacing: "-0.01em"
  body:
    fontFamily: Inter
    fontWeight: 300
    fontSize: 18px
    lineHeight: 1.5
rounded:
  sm: 12px
  md: 24px
  lg: 32px
spacing:
  xs: 12px
  sm: 24px
  md: 48px
  lg: 80px
  xl: 128px
---

# Soft Ambient

Designed to live on top of the Mood Engine's video layer. Should feel like a
gentle annotation, not a UI.

## Overview

Translucent surfaces, low-weight Inter, near-pastel accent. The text should
read clearly over a video without fighting it. Frosted-glass cards (the `surface`
token plus a backdrop-blur if available) replace solid panels.

## Colors

- `bg` is transparent so the mood video shows through.
- `surface` is a translucent white film — use sparingly for cards.
- `accent` is a muted blush — apply to small typographic accents, never fills.
- `text` is a warm cream that reads against most video backgrounds.

## Typography

Inter at weight 300. Display sizes stay modest (max ~5rem); the goal isn't to
shout, it's to whisper. Letter-spacing slightly negative on display.

## Layout

- One element per scene, generously padded.
- Anchor near the bottom or off-center; leave the upper third for the video to
  breathe.
- Rounded corners are heavy here (24px+) — they reinforce the pillowy feel.

## Don't

- Don't use solid opaque backgrounds — break the mood-video illusion.
- Don't use bold weights (≥ 600) — feels harsh on top of moving footage.
- Don't fill regions with accent colour — restrict to typographic detail.
```

- [ ] **Step 5: Verify the files copy into the build output**

Run: `cd server && npm run build`

The TypeScript compiler does NOT copy non-`.ts` files into `dist/` by default. Check whether `dist/designs/builtins/quiet-luxury.md` exists:

Run: `ls server/dist/designs/builtins/`
Expected: empty or non-existent.

If empty, the production server (`node dist/index.js`) will not find the seed files. Two options:
- (a) Use a `prebuild` script to copy `src/designs/builtins/*.md` to `dist/`.
- (b) Have `seedBuiltinsFromDir` resolve its directory argument relative to `import.meta.url` and point at `src/designs/builtins/` even from `dist/` — i.e. `new URL('../../src/designs/builtins/', import.meta.url)`.

Pick (a). Edit `server/package.json`:

```json
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json && node -e \"import('node:fs').then(m=>m.cpSync('src/designs/builtins','dist/designs/builtins',{recursive:true}))\"",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
```

Re-run `cd server && npm run build`, then `ls server/dist/designs/builtins/` — expect 4 `.md` files.

- [ ] **Step 6: Commit**

```
git add server/src/designs/builtins/ server/package.json
git commit -m "feat(designs): four built-in design packs"
```

---

## Task 5: Wire seedBuiltins into server boot + http deps

**Files:**
- Modify: `server/src/index.ts` — build `designs` repo, seed at boot
- Modify: `server/src/api/http.ts` — accept `designs` in `HttpDeps`
- Test: `server/test/design-packs.boot.test.ts` — covered by an existing boot integration test if any; otherwise spot-check via repo tests already passing.

- [ ] **Step 1: Read the current `index.ts` boot order**

Run: `grep -n "createScenesRepo\|createDisplaysRepo\|runMigrations\|buildHttpApp" server/src/index.ts | head -20`

You'll see something like `runMigrations(db)` followed by repo factory calls then `buildHttpApp({...})`. The new lines slot in alongside the other repo calls.

- [ ] **Step 2: Build the repo and seed**

Open `server/src/index.ts`. Find the block where `createScenesRepo`, `createDisplaysRepo`, etc. are called. Add:

```ts
import { createDesignPacksRepo } from './store/design-packs.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// (existing imports and code)

const designs = createDesignPacksRepo(db);
// Resolve the builtins folder relative to this file. Works in dev (tsx
// running TS source) and in prod (compiled JS in dist/).
const __dirname = dirname(fileURLToPath(import.meta.url));
designs.seedBuiltinsFromDir(join(__dirname, 'designs', 'builtins'));
```

Place these lines right after `runMigrations(db)` and before `buildHttpApp({...})`. (If the existing file already imports `fileURLToPath` / `dirname` / `join`, skip those imports.)

Pass `designs` into `buildHttpApp({...})`:

```ts
const app = await buildHttpApp({
  // existing keys: displays, settings, scenes, transitions, overrides, haClient, etc.
  designs,
  // ... rest unchanged
});
```

- [ ] **Step 3: Extend HttpDeps**

Open `server/src/api/http.ts`. Find the `HttpDeps` type. Add:

```ts
import type { DesignPacksRepo } from '../store/design-packs.js';

export type HttpDeps = {
  // ...existing fields...
  designs: DesignPacksRepo;
  // ...rest unchanged...
};
```

(Don't register routes yet — Task 6 does that.)

- [ ] **Step 4: Update existing test setup helpers**

Several existing tests (`scenes.api.test.ts`, `mcp-server.test.ts`, `ha-entities.test.ts`, etc.) call `buildHttpApp(ctx)` where `ctx` is built by a `setup()` helper. They'll fail to typecheck once `HttpDeps.designs` is required.

In each affected test file's `setup()` helper, add:

```ts
import { createDesignPacksRepo } from '../src/store/design-packs.js';
// inside setup():
designs: createDesignPacksRepo(db),
```

Files touched (search with `grep -rln "buildHttpApp" server/test/`):
- `server/test/scenes.api.test.ts`
- `server/test/mcp-server.test.ts`
- `server/test/ha-entities.test.ts`
- `server/test/widgets.test.ts`
- `server/test/docs-ha-entities.test.ts`
- (any others that show up in the grep)

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npx vitest run --pool=forks --poolOptions.forks.singleFork`
Expected: PASS — same number of tests as before plus the new repo tests; nothing in unrelated suites broken.

- [ ] **Step 6: Commit**

```
git add server/src/index.ts server/src/api/http.ts server/test/
git commit -m "feat(designs): wire design-packs repo into boot + HttpDeps"
```

---

## Task 6: REST endpoints (`/api/designs/*`)

**Files:**
- Create: `server/src/api/designs.ts`
- Create: `server/test/designs.api.test.ts`
- Modify: `server/src/api/http.ts` — call `registerDesignRoutes(app, deps)`

- [ ] **Step 1: Write the failing API tests**

Create `server/test/designs.api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';
import { buildHttpApp } from '../src/api/http.js';
import { createCanvasExtrasStore } from '../src/api/canvases.js';

const sample = {
  slug: 'minimal',
  name: 'Minimal',
  content: '---\nname: Minimal\ncolors:\n  bg: "#000000"\n  text: "#ffffff"\ntypography:\n  body:\n    fontFamily: Inter\n---\n\n# Body',
};

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const designs = createDesignPacksRepo(db);
  // Pre-seed one builtin so we can test the protect-builtin behaviour.
  designs.seedBuiltinsFromMap({
    'house': { name: 'House', content: '---\nname: House\n---\n\nBuilt-in.' },
  });
  return {
    displays: createDisplaysRepo(db),
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
    designs,
    canvasExtras: createCanvasExtrasStore(),
  };
}

describe('designs REST API', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => { ctx = setup(); app = await buildHttpApp(ctx); });

  it('GET /api/designs returns built-ins with preview shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/designs' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ slug: string; name: string; source: string; preview: { colors: string[]; font_family: string | null } }>;
    expect(body.length).toBe(1);
    expect(body[0].slug).toBe('house');
    expect(body[0].source).toBe('builtin');
    expect(body[0].preview).toBeDefined();
  });

  it('POST /api/designs creates a user pack', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBe('minimal');
    expect(body.source).toBe('user');
    const list = (await app.inject({ method: 'GET', url: '/api/designs' })).json() as Array<{ slug: string }>;
    expect(list.map((p) => p.slug).sort()).toEqual(['house', 'minimal']);
  });

  it('POST /api/designs 400s on duplicate slug', async () => {
    await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    const res = await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/slug/i);
  });

  it('POST /api/designs 400s on missing fields', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/designs', payload: { slug: 'a' } });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/designs/:slug returns full content + parsed frontmatter', async () => {
    await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    const res = await app.inject({ method: 'GET', url: '/api/designs/minimal' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe(sample.content);
    expect(body.frontmatter.name).toBe('Minimal');
    expect(body.body).toContain('# Body');
  });

  it('GET /api/designs/:id (uuid) also resolves', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/designs', payload: sample })).json();
    const res = await app.inject({ method: 'GET', url: `/api/designs/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe('minimal');
  });

  it('GET /api/designs/:slug returns 404 when missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/designs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/designs/:slug updates a user pack', async () => {
    await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    const res = await app.inject({
      method: 'PATCH', url: '/api/designs/minimal',
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Renamed');
  });

  it('PATCH /api/designs/:slug 403s on builtins', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/designs/house',
      payload: { name: 'Stomp' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /api/designs/:slug removes a user pack', async () => {
    await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    const del = await app.inject({ method: 'DELETE', url: '/api/designs/minimal' });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: '/api/designs/minimal' });
    expect(get.statusCode).toBe(404);
  });

  it('DELETE /api/designs/:slug 403s on builtins', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/designs/house' });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run designs.api --pool=forks --poolOptions.forks.singleFork`
Expected: FAIL — routes return 404 (not registered).

- [ ] **Step 3: Implement the routes**

Create `server/src/api/designs.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { DesignPacksRepo } from '../store/design-packs.js';
import { parseDesignPack, previewFromFrontmatter } from '../designs/parse.js';

export type DesignRoutesDeps = {
  designs: DesignPacksRepo;
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

function findByIdOrSlug(repo: DesignPacksRepo, key: string) {
  return repo.getBySlug(key) ?? repo.get(key);
}

export function registerDesignRoutes(app: FastifyInstance, deps: DesignRoutesDeps): void {
  /** GET /api/designs — list with light preview shape for the dropdown. */
  app.get('/api/designs', async () => {
    return deps.designs.list().map((p) => {
      const parsed = parseDesignPack(p.content);
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        source: p.source,
        preview: previewFromFrontmatter(parsed.frontmatter),
      };
    });
  });

  /** GET /api/designs/:idOrSlug — full content + parsed split. */
  app.get<{ Params: { key: string } }>('/api/designs/:key', async (req, reply) => {
    const p = findByIdOrSlug(deps.designs, req.params.key);
    if (!p) return reply.code(404).send({ error: 'not found' });
    const parsed = parseDesignPack(p.content);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      source: p.source,
      content: p.content,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      parseErrors: parsed.errors,
    };
  });

  /** POST /api/designs — create a user pack. */
  app.post<{ Body: { slug?: unknown; name?: unknown; content?: unknown } }>(
    '/api/designs',
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const slug = body.slug;
      const name = body.name;
      const content = body.content;
      if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
        return reply.code(400).send({ error: 'slug must match ^[a-z0-9][a-z0-9-]*[a-z0-9]$ (3-64 chars)' });
      }
      if (typeof name !== 'string' || name.trim() === '') {
        return reply.code(400).send({ error: 'name must be a non-empty string' });
      }
      if (typeof content !== 'string' || content.trim() === '') {
        return reply.code(400).send({ error: 'content must be a non-empty string' });
      }
      if (deps.designs.getBySlug(slug)) {
        return reply.code(400).send({ error: `slug "${slug}" already exists` });
      }
      // Verify frontmatter (if any) is parseable. Body-only is allowed.
      const parsed = parseDesignPack(content);
      if (parsed.errors.length > 0) {
        return reply.code(400).send({ error: parsed.errors[0] });
      }
      const created = deps.designs.create({ slug, name, content, source: 'user' });
      return created;
    }
  );

  /** PATCH /api/designs/:idOrSlug — update name/content of a user pack. */
  app.patch<{ Params: { key: string }; Body: { name?: unknown; content?: unknown } }>(
    '/api/designs/:key',
    async (req, reply) => {
      const p = findByIdOrSlug(deps.designs, req.params.key);
      if (!p) return reply.code(404).send({ error: 'not found' });
      if (p.source === 'builtin') {
        return reply.code(403).send({ error: 'built-in design packs cannot be modified' });
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: { name?: string; content?: string } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.trim() === '') {
          return reply.code(400).send({ error: 'name must be a non-empty string' });
        }
        patch.name = body.name;
      }
      if (body.content !== undefined) {
        if (typeof body.content !== 'string' || body.content.trim() === '') {
          return reply.code(400).send({ error: 'content must be a non-empty string' });
        }
        const parsed = parseDesignPack(body.content);
        if (parsed.errors.length > 0) return reply.code(400).send({ error: parsed.errors[0] });
        patch.content = body.content;
      }
      return deps.designs.update(p.id, patch);
    }
  );

  /** DELETE /api/designs/:idOrSlug — remove a user pack. */
  app.delete<{ Params: { key: string } }>('/api/designs/:key', async (req, reply) => {
    const p = findByIdOrSlug(deps.designs, req.params.key);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (p.source === 'builtin') {
      return reply.code(403).send({ error: 'built-in design packs cannot be deleted' });
    }
    deps.designs.delete(p.id);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Wire into http.ts**

Open `server/src/api/http.ts`. Import the new module and register inside `buildHttpApp`:

```ts
import { registerDesignRoutes } from './designs.js';

// inside buildHttpApp(deps), alongside other register* calls:
registerDesignRoutes(app, { designs: deps.designs });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run designs.api --pool=forks --poolOptions.forks.singleFork`
Expected: PASS — 11 tests.

- [ ] **Step 6: Commit**

```
git add server/src/api/designs.ts server/src/api/http.ts server/test/designs.api.test.ts
git commit -m "feat(api): /api/designs CRUD with built-in protection"
```

---

## Task 7: System prompt — append the design pack section

**Files:**
- Modify: `server/src/agent/system-prompt.ts`
- Test: `server/test/agent.system-prompt.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create or extend `server/test/agent.system-prompt.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDesignPacksRepo, type DesignPacksRepo } from '../src/store/design-packs.js';
import { buildSystemPrompt, _resetSystemPromptCache } from '../src/agent/system-prompt.js';
import { join } from 'node:path';

const docsDir = join(process.cwd(), '..', 'docs'); // monorepo: server/ → repo root → docs/

describe('buildSystemPrompt', () => {
  let designs: DesignPacksRepo;
  beforeEach(() => {
    _resetSystemPromptCache();
    const db = new Database(':memory:');
    runMigrations(db);
    designs = createDesignPacksRepo(db);
  });

  it('omits the DESIGN PACK section when no slug is provided', () => {
    const out = buildSystemPrompt({ docsDir, haClient: null, designs });
    expect(out).not.toContain('DESIGN PACK');
  });

  it('appends the DESIGN PACK section when a known slug is provided', () => {
    designs.create({
      slug: 'test-pack',
      name: 'Test Pack',
      content: '---\nname: Test Pack\n---\n\nBODY-MARKER-SENTINEL',
      source: 'user',
    });
    const out = buildSystemPrompt(
      { docsDir, haClient: null, designs },
      { designPackSlug: 'test-pack' }
    );
    expect(out).toContain('DESIGN PACK');
    expect(out).toContain('BODY-MARKER-SENTINEL');
  });

  it('omits the section silently when slug is unknown (no crash)', () => {
    const out = buildSystemPrompt(
      { docsDir, haClient: null, designs },
      { designPackSlug: 'no-such-slug' }
    );
    expect(out).not.toContain('DESIGN PACK');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run agent.system-prompt --pool=forks --poolOptions.forks.singleFork`
Expected: FAIL — `SystemPromptDeps` doesn't include `designs`; second arg shape unknown.

- [ ] **Step 3: Update buildSystemPrompt signature**

Open `server/src/agent/system-prompt.ts`. Change the `SystemPromptDeps` type and `buildSystemPrompt` to accept the repo and an options arg:

```ts
import type { DesignPacksRepo } from '../store/design-packs.js';

// ...existing imports / cache / readContract / PREAMBLE unchanged...

export type SystemPromptDeps = {
  docsDir: string;
  haClient: HaClient | null;
  designs: DesignPacksRepo;
};

export type SystemPromptOpts = {
  /** Slug of a design pack to append to the prompt. Unknown slugs are
   *  silently ignored (the prompt builds without the section) so a stale
   *  client localStorage value never bricks the chat route. */
  designPackSlug?: string;
};

const DESIGN_PACK_PREAMBLE =
  'When a design pack is provided below, use its YAML frontmatter tokens for ' +
  'exact values (colors, typography, spacing) and the body prose for taste / voice. ' +
  'Token references like {colors.primary} should be resolved to the matching value ' +
  "from the pack's frontmatter when emitting scene/widget config. Never override " +
  'scene-API rules from the contracts above.';

export function buildSystemPrompt(deps: SystemPromptDeps, opts: SystemPromptOpts = {}): string {
  const scene = readContract(deps.docsDir, 'scene-agent', 'sceneAgent');
  const canvas = readContract(deps.docsDir, 'canvas-widget-agent', 'canvasAgent');
  void deps.haClient;

  const sections: string[] = [
    PREAMBLE,
    '',
    '═════════════════════════════════════════════════════════════',
    'SCENE AUTHORING CONTRACT',
    '═════════════════════════════════════════════════════════════',
    scene || '_(scene-agent.md not bundled)_',
    '',
    '═════════════════════════════════════════════════════════════',
    'CANVAS WIDGET CONTRACT',
    '═════════════════════════════════════════════════════════════',
    canvas || '_(canvas-widget-agent.md not bundled)_',
  ];

  if (opts.designPackSlug) {
    const pack = deps.designs.getBySlug(opts.designPackSlug);
    if (pack) {
      sections.push(
        '',
        '═════════════════════════════════════════════════════════════',
        `DESIGN PACK — ${pack.name}`,
        '═════════════════════════════════════════════════════════════',
        DESIGN_PACK_PREAMBLE,
        '',
        pack.content,
      );
    }
  }

  return sections.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run agent.system-prompt --pool=forks --poolOptions.forks.singleFork`
Expected: PASS — 3 tests. Existing callers are still type-broken until Task 8 fixes them.

- [ ] **Step 5: Update existing callers to satisfy the new required `designs` field**

The `agent.ts` chat route currently calls `buildSystemPrompt({docsDir, haClient})`. We're about to fix that in Task 8 anyway, but to keep `npm run build` green between commits, temporarily pass an empty repo there now. Actually, defer: leave the tsc errors and fix in Task 8. (Skip this step.)

- [ ] **Step 6: Commit (with known build break — Task 8 closes it)**

```
git add server/src/agent/system-prompt.ts server/test/agent.system-prompt.test.ts
git commit -m "feat(agent): system prompt accepts optional designPackSlug"
```

---

## Task 8: Agent route — read `designPackSlug`, validate, pass through

**Files:**
- Modify: `server/src/api/agent.ts`
- Test: extend `server/test/agent.api.test.ts` if it exists, otherwise add a minimal smoke test (the route itself is a streaming endpoint and hard to unit-test end-to-end; we test the validation branch only)

- [ ] **Step 1: Write the failing test**

If `server/test/agent.api.test.ts` doesn't exist, create it. Otherwise extend it. Add:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';
import { buildHttpApp } from '../src/api/http.js';
import { createCanvasExtrasStore } from '../src/api/canvases.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const settings = createSettingsRepo(db);
  // Set the agent key so the chat route doesn't 503 before our validation runs.
  settings.set('agent_openrouter_key', 'sk-test');
  return {
    displays: createDisplaysRepo(db),
    settings,
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
    designs: createDesignPacksRepo(db),
    canvasExtras: createCanvasExtrasStore(),
  };
}

describe('POST /api/agent/chat designPackSlug validation', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => { ctx = setup(); app = await buildHttpApp(ctx); });

  it('400s when designPackSlug is provided but unknown', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/agent/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }], designPackSlug: 'not-real' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/design pack/i);
  });
});
```

(This test does NOT exercise the OpenRouter call — the validation branch returns before reaching `streamText`. The test above is a deterministic boundary check.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run agent.api --pool=forks --poolOptions.forks.singleFork`
Expected: FAIL — currently no validation, the route attempts the OpenRouter call.

- [ ] **Step 3: Update the chat route**

Open `server/src/api/agent.ts`. Find the `POST /api/agent/chat` handler. Apply two changes:

1. Update the body type and read the slug:

```ts
app.post<{ Body: { messages?: unknown; designPackSlug?: unknown } }>('/api/agent/chat', async (req, reply) => {
  const { key, model } = readAgentSettings(deps.settings);
  if (!key) {
    return reply.code(503).send({
      error: 'OpenRouter API key not set. Add one in Settings → AI agent.',
    });
  }

  const messages = (req.body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages)) {
    return reply.code(400).send({ error: 'messages must be an array' });
  }

  const designPackSlug = (req.body as { designPackSlug?: unknown })?.designPackSlug;
  let resolvedSlug: string | undefined = undefined;
  if (designPackSlug !== undefined && designPackSlug !== null && designPackSlug !== '') {
    if (typeof designPackSlug !== 'string') {
      return reply.code(400).send({ error: 'designPackSlug must be a string' });
    }
    if (!deps.designs.getBySlug(designPackSlug)) {
      return reply.code(400).send({ error: `design pack "${designPackSlug}" not found` });
    }
    resolvedSlug = designPackSlug;
  }
```

2. Add `designs` to the `AgentRoutesDeps` type (search for `export type AgentRoutesDeps`) and pass `resolvedSlug` to `buildSystemPrompt`:

```ts
export type AgentRoutesDeps = {
  // existing fields...
  designs: DesignPacksRepo;
  // existing fields...
};
```

```ts
const system = buildSystemPrompt(
  { docsDir: deps.docsDir, haClient: deps.haClient, designs: deps.designs },
  { designPackSlug: resolvedSlug }
);
```

3. Wire `designs` through in `http.ts` where `registerAgentRoutes` is called:

```ts
registerAgentRoutes(app, {
  // ...existing fields...
  designs: deps.designs,
  // ...
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run agent.api --pool=forks --poolOptions.forks.singleFork`
Expected: PASS — 1 new test, plus any existing tests in the file unchanged.

- [ ] **Step 5: Run the full server suite to confirm nothing else broke**

Run: `cd server && npx vitest run --pool=forks --poolOptions.forks.singleFork`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```
git add server/src/api/agent.ts server/src/api/http.ts server/test/agent.api.test.ts
git commit -m "feat(agent): chat route reads + validates designPackSlug"
```

---

## Task 9: MCP tools and resources

**Files:**
- Modify: `server/src/mcp/tools.ts` — add 4 tools
- Modify: `server/src/mcp/resources.ts` — add `cosmos://designs` index + dynamic `cosmos://designs/<slug>`
- Modify: `server/src/mcp/server.ts` if resource registration loop needs to be aware of dynamic URIs (likely not — it iterates `listMcpResources()`)
- Test: extend `server/test/mcp-server.test.ts`

- [ ] **Step 1: Extend the resources module**

Open `server/src/mcp/resources.ts`. Add:

```ts
import type { DesignPacksRepo } from '../store/design-packs.js';

// extend McpResourceDeps:
export type McpResourceDeps = {
  docsDir: string;
  haClient: HaClient | null;
  designs: DesignPacksRepo;
};

const URI_DESIGNS_INDEX = 'cosmos://designs';
```

Update `listMcpResources` signature to take `deps`:

```ts
export function listMcpResources(deps: McpResourceDeps): McpResourceListEntry[] {
  const base: McpResourceListEntry[] = [
    // existing 3 entries unchanged
  ];
  base.push({
    uri: URI_DESIGNS_INDEX,
    name: 'Design pack index',
    description:
      'Index of all DESIGN.md-spec design packs available on this Cosmos. Each entry lists slug, name, and source (built-in or user).',
    mimeType: 'text/markdown',
  });
  for (const p of deps.designs.list()) {
    base.push({
      uri: `cosmos://designs/${p.slug}`,
      name: `Design pack — ${p.name}`,
      description: `${p.source === 'builtin' ? 'Built-in' : 'User-authored'} design pack. DESIGN.md format (frontmatter + body).`,
      mimeType: 'text/markdown',
    });
  }
  return base;
}
```

Add resolution in `readMcpResource`:

```ts
export async function readMcpResource(
  uri: string,
  deps: McpResourceDeps
): Promise<McpResourceContents | null> {
  if (uri === URI_SCENE_AGENT) { /* existing */ }
  if (uri === URI_CANVAS_AGENT) { /* existing */ }
  if (uri === URI_ENTITIES) { /* existing */ }
  if (uri === URI_DESIGNS_INDEX) {
    const lines = deps.designs.list().map(
      (p) => `- \`${p.slug}\` — ${p.name} (${p.source})`
    );
    const text = `# Design pack index\n\n${lines.join('\n')}\n`;
    return { uri, mimeType: 'text/markdown', text };
  }
  if (uri.startsWith('cosmos://designs/')) {
    const slug = uri.slice('cosmos://designs/'.length);
    const p = deps.designs.getBySlug(slug);
    if (!p) return null;
    return { uri, mimeType: 'text/markdown', text: p.content };
  }
  return null;
}
```

Update any caller of `listMcpResources()` to pass `deps`. Search:

`grep -rn "listMcpResources" server/src/`

The caller is `server/src/mcp/server.ts`. Update its registration loop to pass `deps`.

- [ ] **Step 2: Add the four MCP tools**

Open `server/src/mcp/tools.ts`. Add to the `createMcpTools` return array:

```ts
{
  name: 'list_designs',
  description:
    'List every design pack available on this Cosmos. Returns slug, name, source (built-in / user), and a small preview shape (first 4 hex colors + body fontFamily). Use this to find packs before calling get_design or before referencing one in a generated scene.',
  inputSchema: z.object({}),
  execute: async () => {
    const r = await inject(app, { method: 'GET', url: '/api/designs' });
    if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
    return jsonResult(r);
  },
},
{
  name: 'get_design',
  description:
    'Read the full content + parsed frontmatter of a design pack by slug. Use the returned `frontmatter.colors`, `frontmatter.typography`, and `body` prose to inform the visual design of any scene or canvas you generate.',
  inputSchema: z.object({ slug: z.string() }),
  execute: async (raw) => {
    const args = raw as { slug: string };
    const r = await inject(app, { method: 'GET', url: `/api/designs/${encodeURIComponent(args.slug)}` });
    if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
    return jsonResult(r);
  },
},
{
  name: 'create_design',
  description:
    'Create a new user design pack. The content must follow the DESIGN.md spec (https://github.com/google-labs-code/design.md): YAML frontmatter with `colors`, `typography`, optional `rounded` / `spacing` / `components`, then markdown body in canonical section order (Overview, Colors, Typography, Layout, Elevation, Shapes, Components, Do\'s and Don\'ts). Slug must be lowercase, hyphen-separated, 3-64 chars. Read cosmos://docs/scene-agent and the existing built-in packs (cosmos://designs/<slug>) for examples before writing one.',
  inputSchema: z.object({
    slug: z.string(),
    name: z.string(),
    content: z.string(),
  }),
  execute: async (raw) => {
    const args = raw as { slug: string; name: string; content: string };
    const r = await inject(app, { method: 'POST', url: '/api/designs', payload: args as import('light-my-request').InjectPayload });
    if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
    return jsonResult(r);
  },
},
{
  name: 'update_design',
  description:
    'Update a user-authored design pack (name and/or content). Built-in packs are read-only and reject updates. Slug is immutable — use create_design to fork.',
  inputSchema: z.object({
    slug: z.string(),
    name: z.string().optional(),
    content: z.string().optional(),
  }),
  execute: async (raw) => {
    const args = raw as { slug: string; name?: string; content?: string };
    const { slug, ...patch } = args;
    const r = await inject(app, {
      method: 'PATCH',
      url: `/api/designs/${encodeURIComponent(slug)}`,
      payload: patch as import('light-my-request').InjectPayload,
    });
    if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
    return jsonResult(r);
  },
},
```

- [ ] **Step 3: Extend the MCP test suite**

Open `server/test/mcp-server.test.ts`. Update the existing tools-list assertion to include the 4 new tools. The current expected list is:

```
'activate_scene', 'assign_scene_to_display', 'create_scene',
'delete_scene', 'delete_widget', 'get_display_palette',
'get_scene', 'list_displays', 'list_ha_entities', 'list_scenes',
'list_transitions', 'list_widgets', 'patch_scene', 'patch_widget',
'summarize_ha_entities', 'update_scene', 'update_widget_content',
```

Add (sorted): `'create_design', 'get_design', 'list_designs', 'update_design'`. The merged sorted list is:

```ts
expect(names).toEqual([
  'activate_scene',
  'assign_scene_to_display',
  'create_design',
  'create_scene',
  'delete_scene',
  'delete_widget',
  'get_design',
  'get_display_palette',
  'get_scene',
  'list_designs',
  'list_displays',
  'list_ha_entities',
  'list_scenes',
  'list_transitions',
  'list_widgets',
  'patch_scene',
  'patch_widget',
  'summarize_ha_entities',
  'update_design',
  'update_scene',
  'update_widget_content',
]);
```

Update the existing `'resources/list returns the three known URIs'` test — it now returns at minimum 4 (3 original + 1 design index when there are no packs seeded; or more if there are).

```ts
it('resources/list includes design pack index and any seeded packs', async () => {
  setEnabled(ctx.settings, true);
  ctx.designs.create({ slug: 'sample', name: 'Sample', content: '---\nname: Sample\n---\nbody', source: 'user' });
  const token = regenerateToken(ctx.settings);
  const res = await rpc(app, { jsonrpc: '2.0', id: 4, method: 'resources/list' }, `Bearer ${token}`);
  const uris = res.json().result.resources.map((r: { uri: string }) => r.uri);
  expect(uris).toContain('cosmos://designs');
  expect(uris).toContain('cosmos://designs/sample');
});
```

Add a tools/call round-trip:

```ts
it('tools/call list_designs returns the seeded packs', async () => {
  setEnabled(ctx.settings, true);
  ctx.designs.create({ slug: 'a', name: 'A', content: '---\nname: A\n---\nb', source: 'user' });
  const token = regenerateToken(ctx.settings);
  const res = await rpc(app, {
    jsonrpc: '2.0', id: 99, method: 'tools/call',
    params: { name: 'list_designs', arguments: {} },
  }, `Bearer ${token}`);
  expect(res.statusCode).toBe(200);
  const list = JSON.parse(res.json().result.content[0].text) as Array<{ slug: string }>;
  expect(list.map((p) => p.slug)).toContain('a');
});
```

Note the `setup()` helper in the file already creates a `designs` repo (Task 5 added it); the `ctx.designs` reference works.

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run mcp-server --pool=forks --poolOptions.forks.singleFork`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```
git add server/src/mcp/tools.ts server/src/mcp/resources.ts server/src/mcp/server.ts server/test/mcp-server.test.ts
git commit -m "feat(mcp): design pack tools + resources"
```

---

## Task 10: Display — DesignPackPicker component + chat integration

**Files:**
- Create: `display/src/lib/admin/DesignPackPicker.svelte`
- Modify: `display/src/lib/admin/Chat.svelte` — mount the picker, send `designPackSlug` in the chat body
- Modify: `display/src/lib/admin/api.ts` — add `designs.list()` and `designs.get(slug)`

- [ ] **Step 1: Add API wrappers**

Open `display/src/lib/admin/api.ts`. Add a new export following the existing pattern (find an existing wrapper like `agent.getSettings` or `scenes.list` to mirror):

```ts
export const designs = {
  async list(): Promise<Array<{
    id: string; slug: string; name: string; source: 'builtin' | 'user';
    preview: { colors: string[]; font_family: string | null };
  }>> {
    const r = await fetch('/api/designs');
    if (!r.ok) throw new Error(`GET /api/designs failed: ${r.status}`);
    return r.json();
  },
  async get(slug: string): Promise<{
    id: string; slug: string; name: string; source: 'builtin' | 'user';
    content: string; frontmatter: Record<string, unknown>; body: string; parseErrors: string[];
  }> {
    const r = await fetch(`/api/designs/${encodeURIComponent(slug)}`);
    if (!r.ok) throw new Error(`GET /api/designs/${slug} failed: ${r.status}`);
    return r.json();
  },
};
```

- [ ] **Step 2: Create the DesignPackPicker component**

Create `display/src/lib/admin/DesignPackPicker.svelte`:

```svelte
<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { designs } from './api';

  const STORAGE_KEY = 'cosmos.agent.designPack';

  type Pack = {
    id: string;
    slug: string;
    name: string;
    source: 'builtin' | 'user';
    preview: { colors: string[]; font_family: string | null };
  };

  let packs: Pack[] = [];
  let selectedSlug: string = '';
  let loaded = false;

  const dispatch = createEventDispatcher<{ change: { slug: string | null } }>();

  onMount(async () => {
    try {
      packs = await designs.list();
    } catch {
      packs = [];
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && packs.some((p) => p.slug === stored)) {
      selectedSlug = stored;
    }
    loaded = true;
    dispatch('change', { slug: selectedSlug || null });
  });

  function onChange() {
    if (selectedSlug) localStorage.setItem(STORAGE_KEY, selectedSlug);
    else localStorage.removeItem(STORAGE_KEY);
    dispatch('change', { slug: selectedSlug || null });
  }

  $: builtins = packs.filter((p) => p.source === 'builtin');
  $: userPacks = packs.filter((p) => p.source === 'user');
  $: current = packs.find((p) => p.slug === selectedSlug) ?? null;
</script>

{#if loaded}
  <div class="design-pack-picker">
    <label for="design-pack-select">
      <span class="label-text">Design</span>
    </label>
    <select id="design-pack-select" bind:value={selectedSlug} on:change={onChange}>
      <option value="">— None —</option>
      {#if builtins.length > 0}
        <optgroup label="Built-in">
          {#each builtins as p}<option value={p.slug}>{p.name}</option>{/each}
        </optgroup>
      {/if}
      {#if userPacks.length > 0}
        <optgroup label="Yours">
          {#each userPacks as p}<option value={p.slug}>{p.name}</option>{/each}
        </optgroup>
      {/if}
    </select>
    {#if current}
      <div class="preview" aria-label="Design pack preview">
        <div class="swatches">
          {#each current.preview.colors as c}<span class="swatch" style="background: {c}"></span>{/each}
        </div>
        {#if current.preview.font_family}
          <span class="font" style="font-family: {current.preview.font_family}, system-ui, sans-serif">
            {current.preview.font_family}
          </span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .design-pack-picker {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--c-border, rgba(255,255,255,0.08));
    border-radius: 8px;
    background: var(--c-surface, rgba(255,255,255,0.02));
    flex-wrap: wrap;
  }
  .label-text {
    font-size: 0.85rem;
    color: var(--c-text-muted, #9b9b9b);
  }
  select {
    background: transparent;
    color: var(--c-text, #f0f0f0);
    border: 1px solid var(--c-border, rgba(255,255,255,0.12));
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font: inherit;
    min-height: 2rem;
  }
  .preview {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }
  .swatches { display: inline-flex; gap: 2px; }
  .swatch {
    width: 16px; height: 16px; border-radius: 3px;
    border: 1px solid rgba(255,255,255,0.06);
  }
  .font {
    font-size: 0.85rem;
    color: var(--c-text-muted, #9b9b9b);
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255,255,255,0.04);
  }
</style>
```

- [ ] **Step 3: Mount inside Chat.svelte**

Open `display/src/lib/admin/Chat.svelte`. At the top of `<script>`, import the picker and add a state variable:

```svelte
<script lang="ts">
  // ...existing imports...
  import DesignPackPicker from './DesignPackPicker.svelte';

  // ...existing state...
  let designPackSlug: string | null = null;

  function handleDesignChange(e: CustomEvent<{ slug: string | null }>) {
    designPackSlug = e.detail.slug;
  }
</script>
```

The `useChat` invocation needs to send `designPackSlug` in every chat request. Find the `useChat({...})` config and ensure the `body` field is reactive. Vercel AI SDK's `useChat` accepts a `body` config that ships with each request — pass a function returning current state:

```ts
const { messages, input, handleSubmit, /* ... */ } = useChat({
  api: '/api/agent/chat',
  // existing config keys...
  body: () => ({ designPackSlug }),
  // or, if the pinned SDK version doesn't support a function body, set it
  // imperatively before submit (see fallback in Step 4 below).
});
```

In the template, add the picker just above the composer textarea. Find the form / textarea block (around `inputEl` ref) and place:

```svelte
<DesignPackPicker on:change={handleDesignChange} />

<form on:submit={handleSubmit}>
  <!-- existing textarea + send button -->
</form>
```

- [ ] **Step 4: Fallback if `body` is not a function in the pinned `@ai-sdk/svelte`**

If the version pinned doesn't accept a `() => body` callable, intercept the submit:

```svelte
<script>
  // ...existing...
  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    // Mutate the chat hook's body before delegating to its handler.
    // The hook exposes a setter; if not, fall back to fetch directly.
    handleSubmit(e, { body: { designPackSlug } });
  }
</script>

<form on:submit={onSubmit}>
  <!-- existing textarea + send button -->
</form>
```

`handleSubmit(e, { body })` is the documented per-call extension point in Vercel AI SDK ≥ 3.x.

- [ ] **Step 5: Verify the display app builds**

Run: `cd display && npm run build`
Expected: clean build. If TypeScript errors surface in `Chat.svelte` due to the `useChat` body shape, check the SDK version (`grep "@ai-sdk/svelte" display/package.json`) and consult [https://sdk.vercel.ai/docs/reference/ai-sdk-ui/use-chat](https://sdk.vercel.ai/docs/reference/ai-sdk-ui/use-chat) for the version-specific signature.

- [ ] **Step 6: Manual smoke check**

Start dev: `npm run dev:server` (in one terminal) and `npm run dev:display` (in another).

Open `http://localhost:5173/admin/agent`. Confirm:
1. The picker shows above the composer.
2. The dropdown lists the 4 built-ins under "Built-in".
3. Selecting "Quiet Luxury" shows 4 swatches + `Inter` chip.
4. Page reload preserves the selection.
5. Send a message; in DevTools Network tab, the request to `/api/agent/chat` has `designPackSlug: "quiet-luxury"` in the body.

- [ ] **Step 7: Commit**

```
git add display/src/lib/admin/DesignPackPicker.svelte display/src/lib/admin/Chat.svelte display/src/lib/admin/api.ts
git commit -m "feat(admin): design pack picker + chat integration"
```

---

## Task 11: User-facing authoring docs

**Files:**
- Create: `docs/design-pack-authoring.md`

- [ ] **Step 1: Write the doc**

Create `docs/design-pack-authoring.md`:

```md
# Authoring a Cosmos design pack

A **design pack** is a single markdown file conforming to the [DESIGN.md
spec](https://github.com/google-labs-code/design.md) (Google Labs).
Cosmos's in-product agent and any external MCP agent appends the
selected pack to its system prompt — the pack supplies *taste* (palette,
typography, density, voice) on top of the API contracts that always go
in.

## Shape

```md
---
name: My Pack
description: One-liner shown in the picker.
colors:
  bg: "#0d0c0a"
  text: "#f3ecd8"
  accent: "#c8b896"
typography:
  display:
    fontFamily: Fraunces
    fontWeight: 500
  body:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 18px
rounded:
  sm: 4px
  md: 8px
spacing:
  xs: 8px
  sm: 16px
  md: 32px
---

# My Pack

## Overview
...

## Colors
...

## Typography
...

## Layout
...

## Don't
...
```

The frontmatter is parsed as YAML. The body is freeform markdown in the
canonical section order (Overview, Colors, Typography, Layout, Elevation,
Shapes, Components, Do's and Don'ts). Cosmos doesn't enforce that order
beyond what the design.md linter does; the agent is most reliable when
the standard sections are present.

## How tokens reach a scene

When the agent emits `background.color` for a scene or inline `style="..."`
for a canvas, it resolves token references like `{colors.accent}` to the
literal value from the pack's frontmatter. Tokens you don't use are
ignored — define what's useful, omit the rest.

## Authoring options

- **Via MCP** (recommended for agents): call `create_design({slug, name,
  content})`. The slug must match `^[a-z0-9][a-z0-9-]+[a-z0-9]$`. To
  iterate on an existing user pack, call `update_design({slug, content})`.
- **Via REST**: `POST /api/designs` with `{slug, name, content}`. Same
  validation. Built-ins are read-only — `PATCH` and `DELETE` against a
  built-in slug return 403.

## What "good" looks like

A pack is doing its job when two scenes the agent generates with that
pack selected look like they belong in the same family — even if the
prompts were unrelated. If you swap the pack and ask the same question,
the result should look meaningfully different.

Aim for:

- 4-6 colors in `colors`. More than that and the agent will pick at
  random.
- Two type roles (`display` and `body`) at minimum. Adding a `mono` role
  is fine if you intend canvases to use mono numerals.
- 150-300 words of body prose. Less and the agent doesn't have enough
  taste signal; more and you're paying for tokens that won't change the
  output.
- An explicit "Don't" section. The agent over-indexes on positive
  guidance — telling it what to avoid is high leverage.
```

- [ ] **Step 2: Commit**

```
git add docs/design-pack-authoring.md
git commit -m "docs: design pack authoring primer"
```

---

## Task 12: CHANGELOG + addon version bump

**Files:**
- Modify: `addon/config.yaml` — bump version
- Modify: `addon/CHANGELOG.md` — add 0.6.0 entry

- [ ] **Step 1: Bump version**

Open `addon/config.yaml`. Change:

```yaml
version: "0.5.5"
```

to:

```yaml
version: "0.6.0"
```

- [ ] **Step 2: Add CHANGELOG entry**

Open `addon/CHANGELOG.md`. Insert at the top (above `## 0.5.5`):

```md
## 0.6.0

- Feat: **Design pack library**. The in-product agent and external MCP agents now pull from a library of [DESIGN.md-spec](https://github.com/google-labs-code/design.md) packs that act as a shared visual taste layer on top of the existing scene/canvas API contracts. Four built-ins ship with this release: **Quiet Luxury**, **Editorial**, **Neo-Brutalist**, **Soft Ambient**.
- Feat: New dropdown above the chat composer in `/admin/agent` lets users pick a design pack per conversation. Selection is sticky in localStorage (`cosmos.agent.designPack`); the slug rides along on every chat request and is appended to the system prompt server-side. Picking "None" reverts to the previous (pack-less) behaviour.
- Feat: New MCP tools `list_designs`, `get_design`, `create_design`, `update_design` (no destructive `delete_design` — admin-only). New MCP resources `cosmos://designs` (index) and `cosmos://designs/<slug>` (full pack content). External agents can now author and persist new packs back to Cosmos for reuse.
- Feat: New REST surface — `GET/POST/PATCH/DELETE /api/designs(/:idOrSlug)`. Built-in packs are read-only (PATCH/DELETE return 403); user packs are full CRUD.
- Docs: New `docs/design-pack-authoring.md` primer for users + agents creating packs.
```

- [ ] **Step 3: Final verification — full test suite + build**

```
cd server && npx vitest run --pool=forks --poolOptions.forks.singleFork
cd .. && npm --workspace server run build
npm --workspace display run build
```

Expected: all green, both builds clean.

- [ ] **Step 4: Commit**

```
git add addon/config.yaml addon/CHANGELOG.md
git commit -m "chore(addon): bump to 0.6.0 — design pack library"
```

---

## Verification (post-implementation, before declaring done)

Run through the spec's `## Verification` section end-to-end:

1. ☑ Tests: `cd server && npx vitest run --pool=forks --poolOptions.forks.singleFork` — all green
2. ☑ Builds: `npm --workspace server run build` and `npm --workspace display run build` clean
3. ☑ Boot smoke: `npm run dev:server` then `curl localhost:8099/api/designs` returns 4 built-ins with `preview` shape
4. ☑ Round-trip via REST (POST → GET → PATCH → 403 on built-in PATCH → DELETE 204)
5. ☑ Round-trip via MCP (`tools/call list_designs`, `get_design`, `create_design`, `get_design` again)
6. ☑ Admin UI: dropdown shows packs, swatches render, selection persists, chat body includes `designPackSlug`
7. ☑ System prompt assertion: covered by the new `agent.system-prompt.test.ts`
8. ☑ Visual smoke: tell the agent "make a kitchen morning scene" with **Quiet Luxury** vs **Neo-Brutalist** selected — outputs should look distinctly different
