# Cosmos Scenes & Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Hello, <name>" greeting from Plan 1 with a real scene canvas. The server stores scenes (layout + widgets + background + typography), assembles scene state with mocked data for HA-driven widgets, and pushes it to displays over the existing WebSocket. Displays render the scene with three core widgets (clock, weather, entity tile), two background modes (solid, continuously animated gradient), per-scene typography, and a global safe-area padding setting.

**Architecture:** Build on Plan 1's server + display. Add a `scenes` table (with `widgets` and a `scenes_displays` junction), a `scenesRepo`, REST endpoints under `/api/scenes`, a server-side scene-state assembler that injects mock data for weather/entity widgets, and a WS push protocol (`{type: 'scene', state: ...}`) sent on hello and on scene updates. Display app gets a `SceneCanvas` Svelte component composing `BackgroundLayer` + a CSS-Grid widget layer; widgets are pure render components fed by the pushed state. No HA in this plan — that's Plan 4.

**Tech Stack:** Same as Plan 1 (Node/TS, Fastify, ws, better-sqlite3, SvelteKit, Vitest) plus `@fontsource/*` packages for bundled fonts.

---

## Common Conventions (read once, applies to every task)

- All work happens on a fresh feature branch off `main`. Create at the start of Task 0: `git checkout main && git checkout -b cosmos-scenes-and-widgets`.
- Server tests live in `server/test/`, source in `server/src/`. Imports use `.js` extensions (Bundler module resolution). Plan 1's `runMigrations`, `openDatabase`, `createDisplaysRepo`, `createSettingsRepo`, `buildHttpApp`, `attachWsHub` all exist and are reused.
- Display tests are not introduced in this plan (no Vitest browser mode setup yet). The end-to-end Playwright smoke in the final task is the display-side gate.
- TDD on every task that creates new code: write the failing test, run it and SEE it fail, implement, run it and SEE it pass, commit.
- Every commit message uses the conventional format: `feat|fix|chore|refactor(scope): subject`.
- Stage exactly the files listed in each task's commit step. Do not add scratch files.

---

## File Structure

New files this plan creates:

```
server/src/
  store/
    scenes.ts                # scenes + widgets + assignments CRUD
  scenes/
    assembler.ts             # buildSceneState(sceneId) -> SceneState (resolves widgets, injects mock data)
    mockData.ts              # MOCK_WEATHER + MOCK_ENTITIES fixtures
    types.ts                 # shared SceneState + WidgetState types
  api/
    scenes.ts                # REST routes: POST/GET/PUT/DELETE /api/scenes, POST /api/displays/:name/scene
display/src/
  lib/
    types.ts                 # mirrors server SceneState/WidgetState
    scene/
      SceneCanvas.svelte     # composes background + widget grid
      WidgetSlot.svelte      # positions a widget in the grid
    backgrounds/
      Background.svelte      # picks Solid or Gradient based on type
      Solid.svelte
      Gradient.svelte        # continuous motion, speed-aware
    widgets/
      Clock.svelte
      Weather.svelte
      EntityTile.svelte
    fonts.css                # @font-face declarations for bundled fonts
display/static/
  fonts/                     # populated by @fontsource packages copied at build
```

Modified files:

```
server/src/
  config.ts                  # anchor staticDir + dbPath defaults to import.meta.url
  index.ts                   # SIGTERM/SIGINT graceful shutdown; pass new repos through
  store/migrations.ts        # add migration v2; remove redundant schema_version from v1
  store/displays.ts          # add setCurrentScene + setDefaultScene + getById
  api/http.ts                # accept scenesRepo dep; mount api/scenes routes
  api/ws.ts                  # on hello, push current scene state; expose pushSceneTo(displayId)
display/src/
  lib/ws.ts                  # add error/close handler; type ServerMessage to include 'scene'
  routes/+page.svelte        # render SceneCanvas when scene received; keep onboarding fallback
  app.html                   # link fonts.css
package-lock.json            # @fontsource/* installs
```

---

## Task 0: Carry-over fixes from Plan 1

These three small fixes were called out in Plan 1's final review and are easier to land before more code piles on the same files.

**Files:**
- Modify: `server/src/config.ts`
- Modify: `server/src/index.ts`
- Modify: `display/src/lib/ws.ts`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git checkout -b cosmos-scenes-and-widgets
```

- [ ] **Step 2: Anchor `config.ts` defaults to `import.meta.url`**

Replace the entire contents of `server/src/config.ts` with:

```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

export const config = {
  port: Number(process.env.PORT ?? 8099),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? resolve(repoRoot, 'data', 'cosmos.db'),
  staticDir: process.env.STATIC_DIR ?? resolve(repoRoot, 'display', 'build'),
};
```

`here` resolves to `server/src/` in dev (tsx) and `server/dist/` after build, both two levels deep from the repo root — `repoRoot` is correct in either case.

- [ ] **Step 3: Add graceful shutdown to `server/src/index.ts`**

Replace the `main()` function in `server/src/index.ts` with:

```ts
import { config } from './config.js';
import { openDatabase } from './store/db.js';
import { runMigrations } from './store/migrations.js';
import { createDisplaysRepo } from './store/displays.js';
import { createSettingsRepo } from './store/settings.js';
import { buildHttpApp } from './api/http.js';
import { attachWsHub } from './api/ws.js';
import { registerStatic } from './static.js';

async function main() {
  const db = openDatabase(config.dbPath);
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);

  const app = await buildHttpApp({ displays, settings });
  await registerStatic(app, config.staticDir);
  const wss = attachWsHub(app.server, { displays });

  await app.listen({ port: config.port, host: config.host });
  console.log(`cosmos server listening on http://${config.host}:${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`received ${signal}, shutting down`);
    try {
      wss.close();
      await app.close();
      db.close();
    } catch (err) {
      console.error('error during shutdown', err);
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Add error/close handlers to `display/src/lib/ws.ts`**

Replace the `connect` function in `display/src/lib/ws.ts` with this version (keep `WelcomeMessage` and `ServerMessage` types unchanged for now — Task 7 extends `ServerMessage`):

```ts
export function connect(displayName: string, onMessage: (msg: ServerMessage) => void): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/ws`;
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'hello', displayName }));
  });
  ws.addEventListener('message', (event) => {
    try {
      const parsed = JSON.parse(event.data) as ServerMessage;
      onMessage(parsed);
    } catch {
      onMessage({ type: 'error', error: 'invalid server message' });
    }
  });
  ws.addEventListener('error', () => {
    onMessage({ type: 'error', error: 'websocket error' });
  });
  ws.addEventListener('close', (event) => {
    if (!event.wasClean) {
      onMessage({ type: 'error', error: 'connection lost' });
    }
  });
  return ws;
}
```

- [ ] **Step 5: Build, run tests, smoke-check**

```bash
npm --workspace server run build
npm test
```

Expected: server builds cleanly, all 15 tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/config.ts server/src/index.ts display/src/lib/ws.ts
git commit -m "fix: anchor server config paths, add graceful shutdown, handle ws errors"
```

---

## Task 1: Migration v2 — scenes, widgets, assignments

Add the schema for scenes. Also clean up the redundant `schema_version` declaration inside migration 1 (called out in Plan 1's review).

**Files:**
- Modify: `server/src/store/migrations.ts`
- Modify: `server/test/migrations.test.ts`

- [ ] **Step 1: Update the failing test in `server/test/migrations.test.ts`**

Replace the file contents with:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm --workspace server test -- migrations
```

Expected: failures on the new "scenes/widgets/scenes_displays" assertion and the new "default_scene_id" assertion.

- [ ] **Step 3: Update `server/src/store/migrations.ts`**

Replace the file contents with:

```ts
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
```

(The migration v1 body no longer redeclares `schema_version` — the preamble handles it.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm --workspace server test -- migrations
```

Expected: all 3 tests pass.

- [ ] **Step 5: Run the full suite to make sure displays/settings tests still pass**

```bash
npm --workspace server test
```

Expected: 16 tests pass (was 15; +1 for the new versions test, and one of the old migration tests changed name but the count is the same +1).

- [ ] **Step 6: Commit**

```bash
git add server/src/store/migrations.ts server/test/migrations.test.ts
git commit -m "feat(server): add migration v2 for scenes, widgets, assignments"
```

---

## Task 2: Scenes repository

CRUD for scenes (with their widgets) and assignments to displays.

**Files:**
- Create: `server/src/store/scenes.ts`
- Create: `server/test/scenes.test.ts`

- [ ] **Step 1: Write the failing test `server/test/scenes.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createScenesRepo, type SceneInput } from '../src/store/scenes.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return {
    scenes: createScenesRepo(db),
    displays: createDisplaysRepo(db),
  };
}

const sample: SceneInput = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid', color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { kind: 'clock', position: { col: 1, row: 1, w: 6, h: 2 }, config: { format: '24h' } },
  ],
};

describe('scenes repo', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('create returns a scene with id and embedded widgets', () => {
    const s = ctx.scenes.create(sample);
    expect(s.id).toMatch(/^[a-z0-9-]{8,}$/);
    expect(s.name).toBe('Morning');
    expect(s.background.type).toBe('solid');
    expect(s.widgets.length).toBe(1);
    expect(s.widgets[0].kind).toBe('clock');
  });

  it('get returns the scene with widgets', () => {
    const created = ctx.scenes.create(sample);
    const fetched = ctx.scenes.get(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.widgets.length).toBe(1);
  });

  it('list returns all scenes', () => {
    ctx.scenes.create({ ...sample, name: 'A' });
    ctx.scenes.create({ ...sample, name: 'B' });
    expect(ctx.scenes.list().map((s) => s.name).sort()).toEqual(['A', 'B']);
  });

  it('update replaces fields and widgets', () => {
    const s = ctx.scenes.create(sample);
    const updated = ctx.scenes.update(s.id, {
      ...sample,
      name: 'Morning v2',
      widgets: [
        { kind: 'weather', position: { col: 1, row: 1, w: 4, h: 3 }, config: { entity_id: 'weather.home' } },
      ],
    });
    expect(updated.name).toBe('Morning v2');
    expect(updated.widgets.length).toBe(1);
    expect(updated.widgets[0].kind).toBe('weather');
  });

  it('delete removes the scene and its widgets', () => {
    const s = ctx.scenes.create(sample);
    ctx.scenes.delete(s.id);
    expect(ctx.scenes.get(s.id)).toBeNull();
  });

  it('assignToDisplay links a scene to a display', () => {
    const s = ctx.scenes.create(sample);
    const d = ctx.displays.registerByName('Living Room');
    ctx.scenes.assignToDisplay(s.id, d.id);
    expect(ctx.scenes.listAssignedTo(d.id).map((x) => x.id)).toEqual([s.id]);
  });

  it('unassignFromDisplay removes the link', () => {
    const s = ctx.scenes.create(sample);
    const d = ctx.displays.registerByName('Kitchen');
    ctx.scenes.assignToDisplay(s.id, d.id);
    ctx.scenes.unassignFromDisplay(s.id, d.id);
    expect(ctx.scenes.listAssignedTo(d.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm --workspace server test -- scenes
```

Expected: module-not-found for `../src/store/scenes.js`.

- [ ] **Step 3: Implement `server/src/store/scenes.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export type Position = { col: number; row: number; w: number; h: number };
export type Layout = { cols: number; rows: number; items: { widget_id: string; col: number; row: number; w: number; h: number }[] };
export type Background =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; colors: string[]; speed: 'slow' | 'medium' | 'fast'; style: 'mesh' | 'linear' | 'radial' };
export type Typography = { font_family: string; font_scale: number };
export type WidgetKind = 'clock' | 'weather' | 'entity_tile';

export type Widget = {
  id: string;
  kind: WidgetKind;
  position: Position;
  config: Record<string, unknown>;
};

export type Scene = {
  id: string;
  name: string;
  layout: Layout;
  background: Background;
  typography: Typography;
  widgets: Widget[];
};

export type SceneInput = Omit<Scene, 'id' | 'widgets'> & {
  widgets: Omit<Widget, 'id'>[];
};

export type ScenesRepo = {
  create(input: SceneInput): Scene;
  get(id: string): Scene | null;
  list(): Scene[];
  update(id: string, input: SceneInput): Scene;
  delete(id: string): void;
  assignToDisplay(sceneId: string, displayId: string): void;
  unassignFromDisplay(sceneId: string, displayId: string): void;
  listAssignedTo(displayId: string): Scene[];
};

type SceneRow = {
  id: string;
  name: string;
  layout_json: string;
  background_json: string;
  typography_json: string;
};
type WidgetRow = {
  id: string;
  scene_id: string;
  kind: string;
  position_json: string;
  config_json: string;
};

function rowToScene(s: SceneRow, widgets: Widget[]): Scene {
  return {
    id: s.id,
    name: s.name,
    layout: JSON.parse(s.layout_json),
    background: JSON.parse(s.background_json),
    typography: JSON.parse(s.typography_json),
    widgets,
  };
}

function rowToWidget(r: WidgetRow): Widget {
  return {
    id: r.id,
    kind: r.kind as WidgetKind,
    position: JSON.parse(r.position_json),
    config: JSON.parse(r.config_json),
  };
}

export function createScenesRepo(db: DB): ScenesRepo {
  const insertScene = db.prepare(
    'INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)'
  );
  const updateScene = db.prepare(
    "UPDATE scenes SET name = ?, layout_json = ?, background_json = ?, typography_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  );
  const deleteScene = db.prepare('DELETE FROM scenes WHERE id = ?');
  const selectSceneById = db.prepare<[string], SceneRow>(
    'SELECT id, name, layout_json, background_json, typography_json FROM scenes WHERE id = ?'
  );
  const selectAllScenes = db.prepare<[], SceneRow>(
    'SELECT id, name, layout_json, background_json, typography_json FROM scenes ORDER BY name'
  );
  const insertWidget = db.prepare(
    'INSERT INTO widgets (id, scene_id, kind, position_json, config_json) VALUES (?, ?, ?, ?, ?)'
  );
  const deleteWidgetsForScene = db.prepare('DELETE FROM widgets WHERE scene_id = ?');
  const selectWidgetsForScene = db.prepare<[string], WidgetRow>(
    'SELECT id, scene_id, kind, position_json, config_json FROM widgets WHERE scene_id = ?'
  );
  const insertAssignment = db.prepare(
    'INSERT OR IGNORE INTO scenes_displays (scene_id, display_id) VALUES (?, ?)'
  );
  const deleteAssignment = db.prepare(
    'DELETE FROM scenes_displays WHERE scene_id = ? AND display_id = ?'
  );
  const selectAssignedScenes = db.prepare<[string], SceneRow>(
    `SELECT s.id, s.name, s.layout_json, s.background_json, s.typography_json
     FROM scenes s
     JOIN scenes_displays sd ON sd.scene_id = s.id
     WHERE sd.display_id = ?
     ORDER BY s.name`
  );

  function loadWidgets(sceneId: string): Widget[] {
    return selectWidgetsForScene.all(sceneId).map(rowToWidget);
  }

  function writeWidgets(sceneId: string, ws: SceneInput['widgets']): Widget[] {
    deleteWidgetsForScene.run(sceneId);
    const out: Widget[] = [];
    for (const w of ws) {
      const id = randomUUID();
      insertWidget.run(id, sceneId, w.kind, JSON.stringify(w.position), JSON.stringify(w.config));
      out.push({ id, kind: w.kind, position: w.position, config: w.config });
    }
    return out;
  }

  function persist(input: SceneInput, sceneId: string, isUpdate: boolean): Scene {
    db.exec('BEGIN');
    try {
      const layout_json = JSON.stringify(input.layout);
      const background_json = JSON.stringify(input.background);
      const typography_json = JSON.stringify(input.typography);
      if (isUpdate) {
        updateScene.run(input.name, layout_json, background_json, typography_json, sceneId);
      } else {
        insertScene.run(sceneId, input.name, layout_json, background_json, typography_json);
      }
      const widgets = writeWidgets(sceneId, input.widgets);
      db.exec('COMMIT');
      return {
        id: sceneId,
        name: input.name,
        layout: input.layout,
        background: input.background,
        typography: input.typography,
        widgets,
      };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    create(input) {
      return persist(input, randomUUID(), false);
    },
    get(id) {
      const row = selectSceneById.get(id);
      if (!row) return null;
      return rowToScene(row, loadWidgets(id));
    },
    list() {
      return selectAllScenes.all().map((row) => rowToScene(row, loadWidgets(row.id)));
    },
    update(id, input) {
      const existing = selectSceneById.get(id);
      if (!existing) throw new Error(`scene ${id} not found`);
      return persist(input, id, true);
    },
    delete(id) {
      deleteScene.run(id);
    },
    assignToDisplay(sceneId, displayId) {
      insertAssignment.run(sceneId, displayId);
    },
    unassignFromDisplay(sceneId, displayId) {
      deleteAssignment.run(sceneId, displayId);
    },
    listAssignedTo(displayId) {
      return selectAssignedScenes.all(displayId).map((row) => rowToScene(row, loadWidgets(row.id)));
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm --workspace server test -- scenes
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/store/scenes.ts server/test/scenes.test.ts
git commit -m "feat(server): add scenes repository with widgets and assignments"
```

---

## Task 3: Extend displays repo with scene assignments

Add `setDefaultScene`, `setCurrentScene`, and `getById` so the WS hub and REST API can manipulate per-display scene state.

**Files:**
- Modify: `server/src/store/displays.ts`
- Modify: `server/test/displays.test.ts`

- [ ] **Step 1: Append two tests to `server/test/displays.test.ts`**

Add these inside the existing `describe('displays repo', ...)` block (after the existing `touch` test):

```ts
  it('setDefaultScene stores the scene id and getById returns it', () => {
    const d = repo.registerByName('Office');
    repo.setDefaultScene(d.id, 'scene-abc');
    const fetched = repo.getById(d.id);
    expect(fetched?.defaultSceneId).toBe('scene-abc');
  });

  it('setCurrentScene stores the active scene id', () => {
    const d = repo.registerByName('Bedroom');
    repo.setCurrentScene(d.id, 'scene-xyz');
    const fetched = repo.getById(d.id);
    expect(fetched?.currentSceneId).toBe('scene-xyz');
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm --workspace server test -- displays
```

Expected: failures because `setDefaultScene`, `setCurrentScene`, `getById`, `defaultSceneId`, and `currentSceneId` don't exist.

- [ ] **Step 3: Update `server/src/store/displays.ts`**

Replace the file contents with:

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export type Display = {
  id: string;
  name: string;
  lastSeen: string | null;
  defaultSceneId: string | null;
  currentSceneId: string | null;
};

export type DisplaysRepo = {
  registerByName(name: string): Display;
  list(): Display[];
  touch(id: string): void;
  getByName(name: string): Display | null;
  getById(id: string): Display | null;
  setDefaultScene(id: string, sceneId: string | null): void;
  setCurrentScene(id: string, sceneId: string | null): void;
};

type Row = {
  id: string;
  name: string;
  last_seen: string | null;
  default_scene_id: string | null;
  current_scene_id: string | null;
};

function rowToDisplay(r: Row): Display {
  return {
    id: r.id,
    name: r.name,
    lastSeen: r.last_seen,
    defaultSceneId: r.default_scene_id,
    currentSceneId: r.current_scene_id,
  };
}

const SELECT_COLS = 'id, name, last_seen, default_scene_id, current_scene_id';

export function createDisplaysRepo(db: DB): DisplaysRepo {
  const selectByName = db.prepare<[string], Row>(`SELECT ${SELECT_COLS} FROM displays WHERE name = ?`);
  const selectById = db.prepare<[string], Row>(`SELECT ${SELECT_COLS} FROM displays WHERE id = ?`);
  const insert = db.prepare('INSERT INTO displays (id, name) VALUES (?, ?)');
  const selectAll = db.prepare<[], Row>(`SELECT ${SELECT_COLS} FROM displays ORDER BY name`);
  const updateLastSeen = db.prepare('UPDATE displays SET last_seen = CURRENT_TIMESTAMP WHERE id = ?');
  const updateDefaultScene = db.prepare('UPDATE displays SET default_scene_id = ? WHERE id = ?');
  const updateCurrentScene = db.prepare('UPDATE displays SET current_scene_id = ? WHERE id = ?');

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
    getById(id) {
      const r = selectById.get(id);
      return r ? rowToDisplay(r) : null;
    },
    setDefaultScene(id, sceneId) {
      updateDefaultScene.run(sceneId, id);
    },
    setCurrentScene(id, sceneId) {
      updateCurrentScene.run(sceneId, id);
    },
  };
}
```

- [ ] **Step 4: Run the displays tests**

```bash
npm --workspace server test -- displays
```

Expected: all 6 tests pass.

- [ ] **Step 5: Run the full suite — older tests that read `Display` may need a quick check**

```bash
npm --workspace server test
```

Expected: all tests pass. The `http.test.ts` tests inspect `Display` JSON; they assert on `name` and `id` only, so the new fields are additive and harmless.

- [ ] **Step 6: Commit**

```bash
git add server/src/store/displays.ts server/test/displays.test.ts
git commit -m "feat(server): extend displays repo with scene assignments"
```

---

## Task 4: Mock data fixtures + scene state assembler

A pure function that takes a scene and returns the full state (with mock data injected for `weather` and `entity_tile` widgets) the display needs to render. This is what the WS hub will push.

**Files:**
- Create: `server/src/scenes/types.ts`
- Create: `server/src/scenes/mockData.ts`
- Create: `server/src/scenes/assembler.ts`
- Create: `server/test/assembler.test.ts`

- [ ] **Step 1: Create `server/src/scenes/types.ts`**

```ts
import type { Scene, Widget } from '../store/scenes.js';

export type ClockData = null;

export type WeatherCurrent = { temp: number; unit: 'C' | 'F'; condition: string; icon: string };
export type WeatherForecastDay = { day: string; high: number; low: number; icon: string };
export type WeatherData = { current: WeatherCurrent; forecast: WeatherForecastDay[] };

export type EntityState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
};
export type EntityTileData = EntityState;

export type WidgetData = ClockData | WeatherData | EntityTileData;

export type WidgetState = Widget & { data: WidgetData };

export type SceneState = Omit<Scene, 'widgets'> & { widgets: WidgetState[] };
```

- [ ] **Step 2: Create `server/src/scenes/mockData.ts`**

```ts
import type { EntityState, WeatherData } from './types.js';

export const MOCK_WEATHER: WeatherData = {
  current: { temp: 18, unit: 'C', condition: 'Partly cloudy', icon: 'partly-cloudy' },
  forecast: [
    { day: 'Mon', high: 21, low: 12, icon: 'sunny' },
    { day: 'Tue', high: 19, low: 11, icon: 'cloudy' },
    { day: 'Wed', high: 17, low: 10, icon: 'rain' },
    { day: 'Thu', high: 20, low: 13, icon: 'partly-cloudy' },
    { day: 'Fri', high: 22, low: 14, icon: 'sunny' },
  ],
};

export const MOCK_ENTITIES: Record<string, EntityState> = {
  'light.living_room': {
    entity_id: 'light.living_room',
    state: 'on',
    attributes: { friendly_name: 'Living Room Light', brightness: 180, rgb_color: [255, 220, 180] },
  },
  'switch.coffee': {
    entity_id: 'switch.coffee',
    state: 'off',
    attributes: { friendly_name: 'Coffee Maker' },
  },
  'sensor.outside_temp': {
    entity_id: 'sensor.outside_temp',
    state: '14.5',
    attributes: { friendly_name: 'Outside Temperature', unit_of_measurement: '°C' },
  },
  'binary_sensor.front_door': {
    entity_id: 'binary_sensor.front_door',
    state: 'off',
    attributes: { friendly_name: 'Front Door', device_class: 'door' },
  },
  'climate.thermostat': {
    entity_id: 'climate.thermostat',
    state: 'heat',
    attributes: { friendly_name: 'Thermostat', current_temperature: 19, temperature: 21 },
  },
  'lock.front_door': {
    entity_id: 'lock.front_door',
    state: 'locked',
    attributes: { friendly_name: 'Front Door Lock' },
  },
  'cover.garage': {
    entity_id: 'cover.garage',
    state: 'closed',
    attributes: { friendly_name: 'Garage Door', current_position: 0 },
  },
};

export function mockEntity(entity_id: string): EntityState {
  return (
    MOCK_ENTITIES[entity_id] ?? {
      entity_id,
      state: 'unknown',
      attributes: { friendly_name: entity_id },
    }
  );
}
```

- [ ] **Step 3: Write the failing test `server/test/assembler.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { Scene } from '../src/store/scenes.js';
import { buildSceneState } from '../src/scenes/assembler.js';

const baseScene: Scene = {
  id: 'scene-1',
  name: 'Test',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid', color: '#000' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { id: 'w1', kind: 'clock', position: { col: 1, row: 1, w: 4, h: 2 }, config: {} },
    { id: 'w2', kind: 'weather', position: { col: 5, row: 1, w: 4, h: 2 }, config: { entity_id: 'weather.home' } },
    { id: 'w3', kind: 'entity_tile', position: { col: 9, row: 1, w: 4, h: 2 }, config: { entity_id: 'light.living_room' } },
    { id: 'w4', kind: 'entity_tile', position: { col: 1, row: 3, w: 4, h: 2 }, config: { entity_id: 'unknown.entity' } },
  ],
};

describe('buildSceneState', () => {
  it('passes scene metadata through unchanged', () => {
    const state = buildSceneState(baseScene);
    expect(state.id).toBe('scene-1');
    expect(state.background).toEqual(baseScene.background);
    expect(state.typography).toEqual(baseScene.typography);
  });

  it('attaches null data to clock widgets', () => {
    const state = buildSceneState(baseScene);
    const clock = state.widgets.find((w) => w.kind === 'clock')!;
    expect(clock.data).toBeNull();
  });

  it('attaches mock weather data to weather widgets', () => {
    const state = buildSceneState(baseScene);
    const weather = state.widgets.find((w) => w.kind === 'weather')!;
    expect(weather.data).toMatchObject({ current: { temp: 18 }, forecast: expect.any(Array) });
  });

  it('attaches mock entity state to entity_tile widgets and falls back for unknown entities', () => {
    const state = buildSceneState(baseScene);
    const known = state.widgets.find((w) => w.id === 'w3')!;
    const unknown = state.widgets.find((w) => w.id === 'w4')!;
    expect((known.data as { state: string }).state).toBe('on');
    expect((unknown.data as { state: string }).state).toBe('unknown');
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

```bash
npm --workspace server test -- assembler
```

Expected: module-not-found.

- [ ] **Step 5: Implement `server/src/scenes/assembler.ts`**

```ts
import type { Scene, Widget } from '../store/scenes.js';
import type { SceneState, WidgetState, WidgetData } from './types.js';
import { MOCK_WEATHER, mockEntity } from './mockData.js';

function dataFor(widget: Widget): WidgetData {
  switch (widget.kind) {
    case 'clock':
      return null;
    case 'weather':
      return MOCK_WEATHER;
    case 'entity_tile': {
      const entityId = String((widget.config as { entity_id?: string }).entity_id ?? '');
      return mockEntity(entityId);
    }
  }
}

export function buildSceneState(scene: Scene): SceneState {
  const widgets: WidgetState[] = scene.widgets.map((w) => ({ ...w, data: dataFor(w) }));
  return {
    id: scene.id,
    name: scene.name,
    layout: scene.layout,
    background: scene.background,
    typography: scene.typography,
    widgets,
  };
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm --workspace server test -- assembler
```

Expected: all 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/scenes/types.ts server/src/scenes/mockData.ts server/src/scenes/assembler.ts server/test/assembler.test.ts
git commit -m "feat(server): add scene state assembler with mock data fixtures"
```

---

## Task 5: REST API for scenes

Add CRUD endpoints + display-assignment endpoints. Wire `scenesRepo` into `buildHttpApp`'s deps.

**Files:**
- Create: `server/src/api/scenes.ts`
- Modify: `server/src/api/http.ts`
- Create: `server/test/scenes.api.test.ts`

- [ ] **Step 1: Write the failing test `server/test/scenes.api.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { buildHttpApp } from '../src/api/http.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  return { displays, settings, scenes };
}

const sample = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid', color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { kind: 'clock', position: { col: 1, row: 1, w: 6, h: 2 }, config: { format: '24h' } },
  ],
};

describe('scenes REST API', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    app = await buildHttpApp(ctx);
  });

  it('POST /api/scenes creates a scene', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/scenes', payload: sample });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Morning');
    expect(body.id).toBeTruthy();
  });

  it('POST /api/scenes returns 400 on missing name', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/scenes', payload: { ...sample, name: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/scenes lists scenes', async () => {
    await app.inject({ method: 'POST', url: '/api/scenes', payload: { ...sample, name: 'A' } });
    await app.inject({ method: 'POST', url: '/api/scenes', payload: { ...sample, name: 'B' } });
    const res = await app.inject({ method: 'GET', url: '/api/scenes' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((s: { name: string }) => s.name).sort()).toEqual(['A', 'B']);
  });

  it('GET /api/scenes/:id returns one scene', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({ method: 'GET', url: `/api/scenes/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(created.id);
  });

  it('GET /api/scenes/:id returns 404 when missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenes/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /api/scenes/:id updates the scene', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/scenes/${created.id}`,
      payload: { ...sample, name: 'Morning v2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Morning v2');
  });

  it('DELETE /api/scenes/:id removes it', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/scenes/${created.id}` });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `/api/scenes/${created.id}` });
    expect(get.statusCode).toBe(404);
  });

  it('POST /api/displays/:name/assign-scene assigns a scene as default', async () => {
    const display = (await app.inject({
      method: 'POST',
      url: '/api/displays/register',
      payload: { name: 'Living Room' },
    })).json();
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/assign-scene`,
      payload: { sceneId: scene.id, makeDefault: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().defaultSceneId).toBe(scene.id);
  });

  it('POST assign-scene returns 404 for unknown display', async () => {
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/Nope/assign-scene',
      payload: { sceneId: scene.id, makeDefault: true },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm --workspace server test -- scenes.api
```

Expected: TypeScript or runtime errors because `scenes` is not a known dep of `buildHttpApp` and the routes do not exist.

- [ ] **Step 3: Create `server/src/api/scenes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { ScenesRepo, SceneInput } from '../store/scenes.js';
import type { DisplaysRepo } from '../store/displays.js';

function isValidSceneInput(body: unknown): body is SceneInput {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || b.name.trim() === '') return false;
  if (typeof b.layout !== 'object' || b.layout === null) return false;
  if (typeof b.background !== 'object' || b.background === null) return false;
  if (typeof b.typography !== 'object' || b.typography === null) return false;
  if (!Array.isArray(b.widgets)) return false;
  return true;
}

export type SceneRoutesDeps = {
  scenes: ScenesRepo;
  displays: DisplaysRepo;
  onSceneChanged?: (displayId: string) => void;
};

export function registerSceneRoutes(app: FastifyInstance, deps: SceneRoutesDeps): void {
  app.post('/api/scenes', async (req, reply) => {
    if (!isValidSceneInput(req.body)) {
      return reply.code(400).send({ error: 'invalid scene payload' });
    }
    return deps.scenes.create(req.body);
  });

  app.get('/api/scenes', async () => deps.scenes.list());

  app.get<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const scene = deps.scenes.get(req.params.id);
    if (!scene) return reply.code(404).send({ error: 'not found' });
    return scene;
  });

  app.put<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    if (!isValidSceneInput(req.body)) {
      return reply.code(400).send({ error: 'invalid scene payload' });
    }
    const existing = deps.scenes.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const updated = deps.scenes.update(req.params.id, req.body);
    notifyAffectedDisplays(req.params.id, deps);
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const existing = deps.scenes.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    deps.scenes.delete(req.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { name: string }; Body: { sceneId?: unknown; makeDefault?: unknown } }>(
    '/api/displays/:name/assign-scene',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const sceneId = typeof req.body?.sceneId === 'string' ? req.body.sceneId : null;
      if (!sceneId) return reply.code(400).send({ error: 'sceneId required' });
      const scene = deps.scenes.get(sceneId);
      if (!scene) return reply.code(404).send({ error: 'scene not found' });
      deps.scenes.assignToDisplay(sceneId, display.id);
      if (req.body?.makeDefault === true) {
        deps.displays.setDefaultScene(display.id, sceneId);
      }
      deps.onSceneChanged?.(display.id);
      return deps.displays.getById(display.id);
    }
  );
}

function notifyAffectedDisplays(sceneId: string, deps: SceneRoutesDeps): void {
  if (!deps.onSceneChanged) return;
  for (const d of deps.displays.list()) {
    if (d.currentSceneId === sceneId || d.defaultSceneId === sceneId) {
      deps.onSceneChanged(d.id);
    }
  }
}
```

- [ ] **Step 4: Update `server/src/api/http.ts`**

Replace the file contents with:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { DisplaysRepo } from '../store/displays.js';
import type { SettingsRepo } from '../store/settings.js';
import type { ScenesRepo } from '../store/scenes.js';
import { registerSceneRoutes } from './scenes.js';

export type HttpDeps = {
  displays: DisplaysRepo;
  settings: SettingsRepo;
  scenes: ScenesRepo;
  onSceneChanged?: (displayId: string) => void;
};

export async function buildHttpApp(deps: HttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.post<{ Body: { name?: unknown } }>('/api/displays/register', async (req, reply) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      return reply.code(400).send({ error: 'name is required' });
    }
    const display = deps.displays.registerByName(name);
    return display;
  });

  app.get('/api/displays', async () => deps.displays.list());

  registerSceneRoutes(app, {
    scenes: deps.scenes,
    displays: deps.displays,
    onSceneChanged: deps.onSceneChanged,
  });

  return app;
}
```

- [ ] **Step 5: Update `server/test/http.test.ts` to provide the new `scenes` dep**

In the existing `setup()` function, add:

```ts
import { createScenesRepo } from '../src/store/scenes.js';
```

and update the body so that the deps object includes `scenes`:

```ts
function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  return buildHttpApp({ displays, settings, scenes });
}
```

- [ ] **Step 6: Run all tests**

```bash
npm --workspace server test
```

Expected: all tests pass — old http.test.ts (4) + new scenes.api.test.ts (9) + everything from prior tasks.

- [ ] **Step 7: Commit**

```bash
git add server/src/api/scenes.ts server/src/api/http.ts server/test/scenes.api.test.ts server/test/http.test.ts
git commit -m "feat(server): add REST API for scenes and display assignment"
```

---

## Task 6: WS hub pushes scene state

The hub now: on `hello`, looks up the display's current or default scene and pushes `{type: 'scene', state}` after the welcome. It also exposes a `pushSceneTo(displayId)` method that the REST API calls when scenes change. Tracks which socket belongs to which display.

**Files:**
- Modify: `server/src/api/ws.ts`
- Modify: `server/test/ws.test.ts`
- Create: `server/test/ws.scene-push.test.ts`
- Modify: `server/src/index.ts` (wire `scenesRepo` and the `onSceneChanged` callback)

- [ ] **Step 1: Update existing `server/test/ws.test.ts` to satisfy the new `attachWsHub` signature**

The hub now requires `scenes` in its deps. Update the imports and `startServer` setup:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { buildHttpApp } from '../src/api/http.js';
import { attachWsHub } from '../src/api/ws.js';

async function startServer() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const app = await buildHttpApp({ displays, settings, scenes });
  attachWsHub(app.server, { displays, scenes });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no address');
  return { app, port: addr.port, displays, scenes };
}
```

The two existing tests (`responds to hello with welcome`, `registers the display`) keep their bodies — they only assert on the welcome and display registration, both of which still occur.

- [ ] **Step 2: Write the new test `server/test/ws.scene-push.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { buildHttpApp } from '../src/api/http.js';
import { attachWsHub } from '../src/api/ws.js';

async function startServer() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const app = await buildHttpApp({ displays, settings, scenes });
  const wss = attachWsHub(app.server, { displays, scenes });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no address');
  return { app, wss, port: addr.port, displays, scenes };
}

const sample = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid' as const, color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { kind: 'clock' as const, position: { col: 1, row: 1, w: 6, h: 2 }, config: {} },
  ],
};

function recvN(ws: WebSocket, n: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const acc: unknown[] = [];
    const handler = (data: WebSocket.RawData) => {
      acc.push(JSON.parse(data.toString()));
      if (acc.length === n) {
        ws.off('message', handler);
        resolve(acc);
      }
    };
    ws.on('message', handler);
  });
}

describe('WebSocket scene push', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    ctx = await startServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('on hello, sends welcome then a scene message when the display has a default scene', async () => {
    const scene = ctx.scenes.create(sample);
    const display = ctx.displays.registerByName('Living Room');
    ctx.displays.setDefaultScene(display.id, scene.id);

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    const recv = recvN(ws, 2);
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Living Room' }));

    const [welcome, scenePush] = (await recv) as [
      { type: string },
      { type: string; state: { id: string; widgets: { kind: string; data: unknown }[] } }
    ];
    expect(welcome.type).toBe('welcome');
    expect(scenePush.type).toBe('scene');
    expect(scenePush.state.id).toBe(scene.id);
    expect(scenePush.state.widgets[0].kind).toBe('clock');
    expect(scenePush.state.widgets[0].data).toBeNull();

    ws.close();
  });

  it('does not send a scene message when the display has no scene assigned', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    const messages: unknown[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Hallway' }));
    await new Promise((r) => setTimeout(r, 100));
    expect(messages.length).toBe(1);
    expect((messages[0] as { type: string }).type).toBe('welcome');
    ws.close();
  });

  it('pushSceneTo sends the current scene state to a connected display', async () => {
    const scene = ctx.scenes.create(sample);
    const display = ctx.displays.registerByName('Kitchen');
    ctx.displays.setDefaultScene(display.id, scene.id);

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    const initial = recvN(ws, 2);
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Kitchen' }));
    await initial;

    const next = recvN(ws, 1);
    ctx.wss.pushSceneTo(display.id);
    const [pushed] = (await next) as [{ type: string; state: { id: string } }];
    expect(pushed.type).toBe('scene');
    expect(pushed.state.id).toBe(scene.id);

    ws.close();
  });
});
```

- [ ] **Step 3: Replace `server/src/api/ws.ts`**

```ts
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { DisplaysRepo } from '../store/displays.js';
import type { ScenesRepo } from '../store/scenes.js';
import { buildSceneState } from '../scenes/assembler.js';

export type WsDeps = {
  displays: DisplaysRepo;
  scenes: ScenesRepo;
};

export type CosmosWss = WebSocketServer & {
  pushSceneTo(displayId: string): void;
};

type ClientMessage = { type: 'hello'; displayName: string };

function isHello(value: unknown): value is ClientMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'hello' &&
    typeof (value as { displayName?: unknown }).displayName === 'string'
  );
}

function activeSceneId(displayId: string, deps: WsDeps): string | null {
  const d = deps.displays.getById(displayId);
  if (!d) return null;
  return d.currentSceneId ?? d.defaultSceneId ?? null;
}

function sceneMessageFor(displayId: string, deps: WsDeps): string | null {
  const sceneId = activeSceneId(displayId, deps);
  if (!sceneId) return null;
  const scene = deps.scenes.get(sceneId);
  if (!scene) return null;
  return JSON.stringify({ type: 'scene', state: buildSceneState(scene) });
}

export function attachWsHub(server: Server, deps: WsDeps): CosmosWss {
  const wss = new WebSocketServer({ server, path: '/ws' }) as CosmosWss;
  const sockets = new Map<string, Set<WebSocket>>();

  wss.on('connection', (socket: WebSocket) => {
    let ownDisplayId: string | null = null;
    socket.on('close', () => {
      if (ownDisplayId) {
        sockets.get(ownDisplayId)?.delete(socket);
      }
    });
    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'invalid json' }));
        return;
      }
      if (!isHello(parsed)) {
        socket.send(JSON.stringify({ type: 'error', error: 'unsupported message' }));
        return;
      }
      const name = parsed.displayName.trim();
      if (!name) {
        socket.send(JSON.stringify({ type: 'error', error: 'displayName required' }));
        return;
      }
      const display = deps.displays.registerByName(name);
      deps.displays.touch(display.id);
      ownDisplayId = display.id;
      const set = sockets.get(display.id) ?? new Set<WebSocket>();
      set.add(socket);
      sockets.set(display.id, set);

      socket.send(
        JSON.stringify({
          type: 'welcome',
          displayId: display.id,
          message: `Hello, ${display.name}!`,
        })
      );

      const sceneMsg = sceneMessageFor(display.id, deps);
      if (sceneMsg) socket.send(sceneMsg);
    });
  });

  wss.pushSceneTo = (displayId: string) => {
    const set = sockets.get(displayId);
    if (!set || set.size === 0) return;
    const sceneMsg = sceneMessageFor(displayId, deps);
    if (!sceneMsg) return;
    for (const s of set) {
      if (s.readyState === s.OPEN) s.send(sceneMsg);
    }
  };

  return wss;
}
```

- [ ] **Step 4: Wire `scenesRepo` and `onSceneChanged` in `server/src/index.ts`**

Replace the `main()` body (preserving the Task 0 graceful-shutdown additions):

```ts
import { config } from './config.js';
import { openDatabase } from './store/db.js';
import { runMigrations } from './store/migrations.js';
import { createDisplaysRepo } from './store/displays.js';
import { createSettingsRepo } from './store/settings.js';
import { createScenesRepo } from './store/scenes.js';
import { buildHttpApp } from './api/http.js';
import { attachWsHub } from './api/ws.js';
import { registerStatic } from './static.js';

async function main() {
  const db = openDatabase(config.dbPath);
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);

  let wssRef: ReturnType<typeof attachWsHub> | null = null;
  const onSceneChanged = (displayId: string) => wssRef?.pushSceneTo(displayId);

  const app = await buildHttpApp({ displays, settings, scenes, onSceneChanged });
  await registerStatic(app, config.staticDir);
  const wss = attachWsHub(app.server, { displays, scenes });
  wssRef = wss;

  await app.listen({ port: config.port, host: config.host });
  console.log(`cosmos server listening on http://${config.host}:${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`received ${signal}, shutting down`);
    try {
      wss.close();
      await app.close();
      db.close();
    } catch (err) {
      console.error('error during shutdown', err);
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Run all tests**

```bash
npm --workspace server test
```

Expected: every server test passes, including the 3 new `ws.scene-push` tests and the existing ws tests.

- [ ] **Step 6: Build the server**

```bash
npm --workspace server run build
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add server/src/api/ws.ts server/src/index.ts server/test/ws.test.ts server/test/ws.scene-push.test.ts
git commit -m "feat(server): push scene state over WebSocket on hello and on update"
```

---

## Task 7: Display — types + WS handler receives scene messages

Mirror the server's `SceneState` types in the display app and extend the page to track an incoming scene. No rendering yet — just confirm the data round-trips.

**Files:**
- Create: `display/src/lib/types.ts`
- Modify: `display/src/lib/ws.ts` (extend `ServerMessage` union)
- Modify: `display/src/routes/+page.svelte`

- [ ] **Step 1: Create `display/src/lib/types.ts`**

```ts
export type Position = { col: number; row: number; w: number; h: number };
export type Layout = { cols: number; rows: number; items: { widget_id: string; col: number; row: number; w: number; h: number }[] };
export type Background =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; colors: string[]; speed: 'slow' | 'medium' | 'fast'; style: 'mesh' | 'linear' | 'radial' };
export type Typography = { font_family: string; font_scale: number };
export type WidgetKind = 'clock' | 'weather' | 'entity_tile';

export type WeatherCurrent = { temp: number; unit: 'C' | 'F'; condition: string; icon: string };
export type WeatherForecastDay = { day: string; high: number; low: number; icon: string };
export type WeatherData = { current: WeatherCurrent; forecast: WeatherForecastDay[] };

export type EntityState = { entity_id: string; state: string; attributes: Record<string, unknown> };

export type WidgetData = null | WeatherData | EntityState;

export type WidgetState = {
  id: string;
  kind: WidgetKind;
  position: Position;
  config: Record<string, unknown>;
  data: WidgetData;
};

export type SceneState = {
  id: string;
  name: string;
  layout: Layout;
  background: Background;
  typography: Typography;
  widgets: WidgetState[];
};
```

- [ ] **Step 2: Extend `display/src/lib/ws.ts`**

Replace the `ServerMessage` type:

```ts
import type { SceneState } from './types';

export type WelcomeMessage = { type: 'welcome'; displayId: string; message: string };
export type SceneMessage = { type: 'scene'; state: SceneState };
export type ErrorMessage = { type: 'error'; error: string };
export type ServerMessage = WelcomeMessage | SceneMessage | ErrorMessage;
```

(Keep the `connect` function from Task 0 unchanged.)

- [ ] **Step 3: Update `display/src/routes/+page.svelte`**

Modify the `<script>` to track a scene; render either the onboarding form (no name yet), the scene canvas (we will add it in Task 8 — for now just show `<pre>{JSON.stringify(scene, null, 2)}</pre>` as a smoke check), the welcome message (no scene assigned yet), or an error.

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getDisplayName, setDisplayName } from '$lib/storage';
  import { connect, type ServerMessage } from '$lib/ws';
  import type { SceneState } from '$lib/types';

  let name: string | null = null;
  let inputName = '';
  let greeting: string | null = null;
  let scene: SceneState | null = null;
  let error: string | null = null;
  let socket: WebSocket | null = null;

  function handleMessage(msg: ServerMessage) {
    if (msg.type === 'welcome') {
      greeting = msg.message;
      error = null;
    } else if (msg.type === 'scene') {
      scene = msg.state;
      error = null;
    } else {
      error = msg.error;
    }
  }

  function start(n: string) {
    name = n;
    socket = connect(n, handleMessage);
  }

  function submitOnboarding(e: Event) {
    e.preventDefault();
    const trimmed = inputName.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
    start(trimmed);
  }

  onMount(() => {
    const stored = getDisplayName();
    if (stored) start(stored);
  });

  onDestroy(() => {
    socket?.close();
  });
</script>

<main style="display:grid;place-items:center;min-height:100vh;text-align:center;padding:2rem">
  {#if !name}
    <form on:submit={submitOnboarding} style="display:grid;gap:1rem;max-width:24rem;width:100%">
      <h1 style="margin:0;font-weight:300">Name this display</h1>
      <input
        bind:value={inputName}
        placeholder="e.g. Living Room"
        autofocus
        style="font-size:1.25rem;padding:0.75rem;border-radius:0.5rem;border:1px solid #333;background:#111;color:inherit"
      />
      <button
        type="submit"
        style="font-size:1.1rem;padding:0.75rem;border-radius:0.5rem;border:none;background:#f5f5f5;color:#0a0a0a;cursor:pointer"
      >
        Continue
      </button>
    </form>
  {:else if error}
    <p style="color:#ff8a8a">Error: {error}</p>
  {:else if scene}
    <pre style="text-align:left;max-width:80vw;overflow:auto;font-size:0.75rem">{JSON.stringify(scene, null, 2)}</pre>
  {:else if greeting}
    <h1 style="font-weight:300;font-size:3rem">{greeting}</h1>
  {:else}
    <p style="opacity:0.6">Connecting…</p>
  {/if}
</main>
```

- [ ] **Step 4: Build the display**

```bash
npm --workspace display run build
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add display/src/lib/types.ts display/src/lib/ws.ts display/src/routes/+page.svelte
git commit -m "feat(display): add scene types and surface scene messages on the page"
```

---

## Task 8: Display — SceneCanvas component (background slot + widget grid)

Compose two layers: a background container and a CSS-Grid widget container. Widgets render as a placeholder string for now — Tasks 9–11 add real widgets.

**Files:**
- Create: `display/src/lib/scene/SceneCanvas.svelte`
- Create: `display/src/lib/scene/WidgetSlot.svelte`
- Modify: `display/src/routes/+page.svelte`

- [ ] **Step 1: Create `display/src/lib/scene/WidgetSlot.svelte`**

```svelte
<script lang="ts">
  import type { WidgetState } from '$lib/types';
  export let widget: WidgetState;
</script>

<div
  class="widget-slot"
  style="grid-column: {widget.position.col} / span {widget.position.w};
         grid-row: {widget.position.row} / span {widget.position.h};"
  data-kind={widget.kind}
>
  <slot {widget}>
    <!-- Placeholder until widgets land in Tasks 9-11 -->
    <div style="opacity:0.5;font-size:0.875rem">{widget.kind}</div>
  </slot>
</div>

<style>
  .widget-slot {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
</style>
```

- [ ] **Step 2: Create `display/src/lib/scene/SceneCanvas.svelte`**

```svelte
<script lang="ts">
  import type { SceneState } from '$lib/types';
  import WidgetSlot from './WidgetSlot.svelte';

  export let scene: SceneState;
</script>

<div class="scene-canvas">
  <div class="background-layer" data-bg-type={scene.background.type}>
    <slot name="background" background={scene.background} />
  </div>
  <div
    class="widget-layer"
    style="grid-template-columns: repeat({scene.layout.cols}, 1fr);
           grid-template-rows: repeat({scene.layout.rows}, 1fr);"
  >
    {#each scene.widgets as widget (widget.id)}
      <WidgetSlot {widget}>
        <slot name="widget" {widget} />
      </WidgetSlot>
    {/each}
  </div>
</div>

<style>
  .scene-canvas {
    position: fixed;
    inset: 0;
    overflow: hidden;
    color: #f5f5f5;
  }
  .background-layer {
    position: absolute;
    inset: 0;
    z-index: 0;
  }
  .widget-layer {
    position: absolute;
    inset: 0;
    display: grid;
    gap: 1rem;
    padding: 1rem;
    z-index: 1;
  }
</style>
```

- [ ] **Step 3: Update `display/src/routes/+page.svelte` to render `SceneCanvas` instead of the JSON dump**

Replace the `{:else if scene}` branch with:

```svelte
  {:else if scene}
    <SceneCanvas {scene} />
```

And add the import at the top of the script:

```ts
import SceneCanvas from '$lib/scene/SceneCanvas.svelte';
```

- [ ] **Step 4: Build the display**

```bash
npm --workspace display run build
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add display/src/lib/scene/SceneCanvas.svelte display/src/lib/scene/WidgetSlot.svelte display/src/routes/+page.svelte
git commit -m "feat(display): add SceneCanvas with background + grid widget layer"
```

---

## Task 9: Display — Clock widget

**Files:**
- Create: `display/src/lib/widgets/Clock.svelte`
- Modify: `display/src/lib/scene/SceneCanvas.svelte` (dispatch widget kinds)
- Modify: `display/src/routes/+page.svelte` (no change here actually — SceneCanvas dispatches internally)

- [ ] **Step 1: Create `display/src/lib/widgets/Clock.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { WidgetState } from '$lib/types';

  export let widget: WidgetState;

  let now = new Date();
  let timer: ReturnType<typeof setInterval>;

  $: format = (widget.config as { format?: string }).format ?? '24h';

  function fmtTime(d: Date): string {
    if (format === '12h') {
      const h = d.getHours() % 12 || 12;
      return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function fmtDate(d: Date): string {
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  onMount(() => {
    timer = setInterval(() => (now = new Date()), 30 * 1000);
  });
  onDestroy(() => clearInterval(timer));
</script>

<div class="clock">
  <div class="time">{fmtTime(now)}</div>
  <div class="date">{fmtDate(now)}</div>
</div>

<style>
  .clock {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }
  .time {
    font-size: clamp(2.5rem, 8vw, 6rem);
    font-weight: 200;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .date {
    font-size: clamp(0.85rem, 1.5vw, 1.25rem);
    opacity: 0.7;
  }
</style>
```

- [ ] **Step 2: Update `SceneCanvas.svelte` to dispatch widgets by kind**

Replace the `<slot name="widget" {widget} />` line in the `WidgetSlot` block with the inline switch:

```svelte
{#each scene.widgets as widget (widget.id)}
  <WidgetSlot {widget} let:widget={w}>
    {#if w.kind === 'clock'}
      <Clock widget={w} />
    {/if}
  </WidgetSlot>
{/each}
```

And add the import:

```ts
import Clock from '$lib/widgets/Clock.svelte';
```

- [ ] **Step 3: Build**

```bash
npm --workspace display run build
```

- [ ] **Step 4: Commit**

```bash
git add display/src/lib/widgets/Clock.svelte display/src/lib/scene/SceneCanvas.svelte
git commit -m "feat(display): add Clock widget"
```

---

## Task 10: Display — Weather widget (mock data)

**Files:**
- Create: `display/src/lib/widgets/Weather.svelte`
- Modify: `display/src/lib/scene/SceneCanvas.svelte`

- [ ] **Step 1: Create `display/src/lib/widgets/Weather.svelte`**

```svelte
<script lang="ts">
  import type { WidgetState, WeatherData } from '$lib/types';
  export let widget: WidgetState;
  $: data = widget.data as WeatherData | null;
</script>

{#if data}
  <div class="weather">
    <div class="current">
      <div class="temp">{data.current.temp}°{data.current.unit}</div>
      <div class="condition">{data.current.condition}</div>
    </div>
    <div class="forecast">
      {#each data.forecast as day (day.day)}
        <div class="day">
          <div class="day-name">{day.day}</div>
          <div class="day-temps">
            <span class="hi">{day.high}°</span>
            <span class="lo">{day.low}°</span>
          </div>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div style="opacity:0.5">No weather</div>
{/if}

<style>
  .weather {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    height: 100%;
    padding: 1rem;
    box-sizing: border-box;
  }
  .current {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .temp {
    font-size: clamp(2rem, 6vw, 4rem);
    font-weight: 200;
    line-height: 1;
  }
  .condition {
    opacity: 0.75;
    font-size: 0.95rem;
  }
  .forecast {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
    margin-top: auto;
  }
  .day {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8rem;
  }
  .day-name {
    opacity: 0.7;
  }
  .day-temps .lo {
    opacity: 0.6;
    margin-left: 0.25rem;
  }
</style>
```

- [ ] **Step 2: Wire it into `SceneCanvas.svelte`**

Add the import and the dispatch branch:

```ts
import Weather from '$lib/widgets/Weather.svelte';
```

```svelte
{:else if w.kind === 'weather'}
  <Weather widget={w} />
```

- [ ] **Step 3: Build & commit**

```bash
npm --workspace display run build
git add display/src/lib/widgets/Weather.svelte display/src/lib/scene/SceneCanvas.svelte
git commit -m "feat(display): add Weather widget"
```

---

## Task 11: Display — EntityTile widget (type-aware)

A single component that selects a renderer based on entity domain. Handles `light`, `switch`, `binary_sensor`, `sensor`, `climate`, `lock`, `cover`, and a generic fallback.

**Files:**
- Create: `display/src/lib/widgets/EntityTile.svelte`
- Modify: `display/src/lib/scene/SceneCanvas.svelte`

- [ ] **Step 1: Create `display/src/lib/widgets/EntityTile.svelte`**

```svelte
<script lang="ts">
  import type { WidgetState, EntityState } from '$lib/types';
  export let widget: WidgetState;

  $: entity = widget.data as EntityState | null;
  $: domain = entity?.entity_id.split('.')[0] ?? '';
  $: friendly = (entity?.attributes.friendly_name as string | undefined) ?? entity?.entity_id ?? 'Unknown';

  function fmtBrightness(b: unknown): string {
    return typeof b === 'number' ? `${Math.round((b / 255) * 100)}%` : '';
  }

  function rgbCss(rgb: unknown): string | null {
    if (Array.isArray(rgb) && rgb.length === 3) return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    return null;
  }
</script>

<div class="tile" data-domain={domain}>
  <div class="label">{friendly}</div>
  {#if !entity}
    <div class="value">—</div>
  {:else if domain === 'light'}
    {@const swatch = rgbCss(entity.attributes.rgb_color)}
    <div class="row">
      <div class="pill" data-on={entity.state === 'on'}>{entity.state}</div>
      {#if swatch}
        <div class="swatch" style="background:{swatch}"></div>
      {/if}
    </div>
    <div class="sub">{fmtBrightness(entity.attributes.brightness)}</div>
  {:else if domain === 'switch' || domain === 'binary_sensor'}
    <div class="pill" data-on={entity.state === 'on'}>{entity.state}</div>
  {:else if domain === 'sensor'}
    <div class="value">{entity.state}<span class="unit">{entity.attributes.unit_of_measurement ?? ''}</span></div>
  {:else if domain === 'climate'}
    <div class="value">{entity.attributes.current_temperature ?? '—'}°</div>
    <div class="sub">target {entity.attributes.temperature ?? '—'}° · {entity.state}</div>
  {:else if domain === 'lock'}
    <div class="pill" data-on={entity.state === 'locked'}>{entity.state}</div>
  {:else if domain === 'cover'}
    <div class="pill" data-on={entity.state === 'open'}>{entity.state}</div>
    {#if typeof entity.attributes.current_position === 'number'}
      <div class="sub">{entity.attributes.current_position}%</div>
    {/if}
  {:else}
    <div class="value">{entity.state}</div>
  {/if}
</div>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.75rem;
  }
  .label {
    font-size: 0.85rem;
    opacity: 0.7;
  }
  .value {
    font-size: clamp(1.5rem, 4vw, 2.5rem);
    font-weight: 300;
    line-height: 1;
  }
  .unit {
    font-size: 0.7em;
    opacity: 0.6;
    margin-left: 0.25rem;
  }
  .sub {
    font-size: 0.85rem;
    opacity: 0.6;
    margin-top: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .pill {
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    font-size: 0.85rem;
    background: rgba(255, 255, 255, 0.08);
  }
  .pill[data-on='true'] {
    background: rgba(255, 200, 100, 0.25);
  }
  .swatch {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }
</style>
```

- [ ] **Step 2: Wire it in `SceneCanvas.svelte`**

```ts
import EntityTile from '$lib/widgets/EntityTile.svelte';
```

```svelte
{:else if w.kind === 'entity_tile'}
  <EntityTile widget={w} />
```

- [ ] **Step 3: Build & commit**

```bash
npm --workspace display run build
git add display/src/lib/widgets/EntityTile.svelte display/src/lib/scene/SceneCanvas.svelte
git commit -m "feat(display): add type-aware EntityTile widget"
```

---

## Task 12: Display — Solid background

**Files:**
- Create: `display/src/lib/backgrounds/Solid.svelte`
- Create: `display/src/lib/backgrounds/Background.svelte`
- Modify: `display/src/lib/scene/SceneCanvas.svelte`

- [ ] **Step 1: Create `display/src/lib/backgrounds/Solid.svelte`**

```svelte
<script lang="ts">
  export let color: string;
</script>

<div class="solid-bg" style="background:{color}"></div>

<style>
  .solid-bg {
    position: absolute;
    inset: 0;
  }
</style>
```

- [ ] **Step 2: Create `display/src/lib/backgrounds/Background.svelte` (dispatcher; the Gradient branch is unused until Task 13)**

```svelte
<script lang="ts">
  import type { Background } from '$lib/types';
  import Solid from './Solid.svelte';
  export let background: Background;
</script>

{#if background.type === 'solid'}
  <Solid color={background.color} />
{:else}
  <Solid color="#101010" />
{/if}
```

- [ ] **Step 3: Update `SceneCanvas.svelte` to use `Background.svelte` instead of relying on a slot**

Replace the `<slot name="background" ... />` element with:

```svelte
<Background background={scene.background} />
```

And add the import:

```ts
import Background from '$lib/backgrounds/Background.svelte';
```

The `<slot name="background" ... />` declaration in the file should be removed; SceneCanvas owns the background dispatch now.

- [ ] **Step 4: Build & commit**

```bash
npm --workspace display run build
git add display/src/lib/backgrounds/Solid.svelte display/src/lib/backgrounds/Background.svelte display/src/lib/scene/SceneCanvas.svelte
git commit -m "feat(display): add solid background renderer"
```

---

## Task 13: Display — Animated gradient background (continuous motion)

The gradient runs an infinite CSS animation while a scene is shown. Uses `@property`-style hue rotation via `background-size` / `background-position` animation. Speed maps to duration; reduced motion freezes to a static gradient.

**Files:**
- Create: `display/src/lib/backgrounds/Gradient.svelte`
- Modify: `display/src/lib/backgrounds/Background.svelte`

- [ ] **Step 1: Create `display/src/lib/backgrounds/Gradient.svelte`**

```svelte
<script lang="ts">
  export let colors: string[];
  export let speed: 'slow' | 'medium' | 'fast' = 'medium';
  export let style: 'mesh' | 'linear' | 'radial' = 'mesh';

  $: cssColors = colors.length > 0 ? colors : ['#1a1a2e', '#16213e', '#0f3460'];
  $: durationS = speed === 'slow' ? 60 : speed === 'fast' ? 12 : 30;

  function gradientCss(stops: string[], style: 'mesh' | 'linear' | 'radial'): string {
    const list = stops.join(', ');
    if (style === 'linear') return `linear-gradient(135deg, ${list})`;
    if (style === 'radial') return `radial-gradient(circle at 30% 30%, ${list})`;
    // mesh: layered radial gradients for that flowing-blob look
    const layers = stops.map((c, i) => {
      const x = (17 * (i + 1)) % 100;
      const y = (29 * (i + 1)) % 100;
      return `radial-gradient(at ${x}% ${y}%, ${c} 0px, transparent 50%)`;
    });
    return layers.join(', ');
  }
</script>

<div
  class="gradient-bg"
  style={`--cosmos-grad: ${gradientCss(cssColors, style)}; --cosmos-grad-duration: ${durationS}s;`}
></div>

<style>
  .gradient-bg {
    position: absolute;
    inset: 0;
    background-image: var(--cosmos-grad);
    background-size: 200% 200%;
    background-position: 0% 0%;
    animation: cosmos-gradient-drift var(--cosmos-grad-duration) ease-in-out infinite alternate;
    will-change: background-position;
  }
  @keyframes cosmos-gradient-drift {
    0%   { background-position: 0% 0%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 50% 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gradient-bg {
      animation: none;
      background-position: 0% 0%;
    }
  }
</style>
```

- [ ] **Step 2: Replace `display/src/lib/backgrounds/Background.svelte`**

```svelte
<script lang="ts">
  import type { Background } from '$lib/types';
  import Solid from './Solid.svelte';
  import Gradient from './Gradient.svelte';
  export let background: Background;
</script>

{#if background.type === 'solid'}
  <Solid color={background.color} />
{:else if background.type === 'gradient'}
  <Gradient colors={background.colors} speed={background.speed} style={background.style} />
{/if}
```

- [ ] **Step 3: Build & commit**

```bash
npm --workspace display run build
git add display/src/lib/backgrounds/Gradient.svelte display/src/lib/backgrounds/Background.svelte
git commit -m "feat(display): add continuously-animated gradient background"
```

---

## Task 14: Display — Typography (bundled fonts + per-scene scale)

Install four `@fontsource/*` packages, expose `--cosmos-font-scale` on the SceneCanvas root.

**Files:**
- Modify: `display/package.json` (deps)
- Create: `display/src/lib/fonts.css`
- Modify: `display/src/app.html` (link the CSS)
- Modify: `display/src/lib/scene/SceneCanvas.svelte` (apply font + scale variables)

- [ ] **Step 1: Install fonts**

```bash
npm --workspace display install @fontsource/inter @fontsource/fraunces @fontsource/jetbrains-mono @fontsource/space-grotesk
```

This adds the packages to `display/package.json` and updates `package-lock.json`.

- [ ] **Step 2: Create `display/src/lib/fonts.css`**

```css
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/200.css';
@import '@fontsource/fraunces/400.css';
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/space-grotesk/300.css';
@import '@fontsource/space-grotesk/400.css';

:root {
  --cosmos-font-Inter: 'Inter', system-ui, sans-serif;
  --cosmos-font-Fraunces: 'Fraunces', Georgia, serif;
  --cosmos-font-JetBrainsMono: 'JetBrains Mono', ui-monospace, monospace;
  --cosmos-font-SpaceGrotesk: 'Space Grotesk', system-ui, sans-serif;
}
```

- [ ] **Step 3: Import the fonts CSS from the layout**

Vite inlines the `@fontsource` `@font-face` declarations and emits the woff2 files into the build output when the CSS is imported from anywhere in the component tree. The layout is the right place. Replace `display/src/routes/+layout.svelte` with:

```svelte
<script lang="ts">
  import '$lib/fonts.css';
</script>

<slot />
```

(No edit to `display/src/app.html` is needed.)

- [ ] **Step 4: Apply font + scale variables in `SceneCanvas.svelte`**

Add to the script:

```ts
const fontVar = (family: string) => `var(--cosmos-font-${family.replace(/\s+/g, '')}, system-ui, sans-serif)`;
```

And replace the wrapping `<div class="scene-canvas">` opening tag with:

```svelte
<div
  class="scene-canvas"
  style="font-family: {fontVar(scene.typography.font_family)};
         --cosmos-font-scale: {scene.typography.font_scale};"
>
```

Update the `font-size`-using styles in widgets to multiply by `--cosmos-font-scale`. For brevity in this plan, only modify the widgets where the scale will read most clearly: in `Clock.svelte`, change `.time` `font-size` to:

```css
.time {
  font-size: calc(clamp(2.5rem, 8vw, 6rem) * var(--cosmos-font-scale, 1));
  font-weight: 200;
  line-height: 1;
  letter-spacing: -0.02em;
}
```

And `.date`:

```css
.date {
  font-size: calc(clamp(0.85rem, 1.5vw, 1.25rem) * var(--cosmos-font-scale, 1));
  opacity: 0.7;
}
```

(Weather and EntityTile already use `clamp()`-based sizes; wrapping them in `calc(... * var(--cosmos-font-scale, 1))` is a follow-up — for v1 the clock is enough to prove the wiring works.)

- [ ] **Step 5: Build**

```bash
npm --workspace display run build
```

Expected: exit 0. If build fails because the bundled fonts aren't being copied to the static output, that's a Vite/SvelteKit asset config issue — the `@fontsource` `.css` imports inline the `@font-face` rules and reference woff2 URLs that Vite resolves via `node_modules` and copies to `_app/immutable/assets/`. This is the standard pattern and usually works without extra config.

- [ ] **Step 6: Commit**

```bash
git add display/package.json package-lock.json display/src/lib/fonts.css display/src/routes/+layout.svelte display/src/lib/scene/SceneCanvas.svelte display/src/lib/widgets/Clock.svelte
git commit -m "feat(display): bundle fonts and apply per-scene typography"
```

---

## Task 15: Global safe-area padding (settings → applied to scene canvas)

A single `safe_area_padding` setting (JSON: `{top, right, bottom, left}` in px) drives `padding` on the widget layer and the overlay layer (overlay layer comes in Plan 4 — for now just the widget layer). Background layer ignores it.

**Files:**
- Modify: `server/src/api/http.ts` (add `GET /api/settings/safe-area`, `PUT /api/settings/safe-area`)
- Create: `server/test/safe-area.test.ts`
- Modify: `server/src/api/ws.ts` (include safe-area in scene push, OR push it as a separate message — we'll merge it into scene state)
- Modify: `server/src/scenes/types.ts` and `server/src/scenes/assembler.ts` (carry `safeArea` in `SceneState`)
- Modify: `display/src/lib/types.ts` (add `safeArea` to `SceneState`)
- Modify: `display/src/lib/scene/SceneCanvas.svelte` (apply padding via inline style on `.widget-layer`)

- [ ] **Step 1: Server — add safe-area helpers + HTTP routes**

In `server/src/api/http.ts`, replace the file with:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { DisplaysRepo } from '../store/displays.js';
import type { SettingsRepo } from '../store/settings.js';
import type { ScenesRepo } from '../store/scenes.js';
import { registerSceneRoutes } from './scenes.js';

export type SafeArea = { top: number; right: number; bottom: number; left: number };
export const DEFAULT_SAFE_AREA: SafeArea = { top: 16, right: 16, bottom: 16, left: 16 };

export function readSafeArea(settings: SettingsRepo): SafeArea {
  const raw = settings.get('safe_area_padding');
  if (!raw) return DEFAULT_SAFE_AREA;
  try {
    const v = JSON.parse(raw) as Partial<SafeArea>;
    return {
      top: Number(v.top ?? DEFAULT_SAFE_AREA.top),
      right: Number(v.right ?? DEFAULT_SAFE_AREA.right),
      bottom: Number(v.bottom ?? DEFAULT_SAFE_AREA.bottom),
      left: Number(v.left ?? DEFAULT_SAFE_AREA.left),
    };
  } catch {
    return DEFAULT_SAFE_AREA;
  }
}

export type HttpDeps = {
  displays: DisplaysRepo;
  settings: SettingsRepo;
  scenes: ScenesRepo;
  onSceneChanged?: (displayId: string) => void;
  onSettingsChanged?: () => void;
};

export async function buildHttpApp(deps: HttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.post<{ Body: { name?: unknown } }>('/api/displays/register', async (req, reply) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return reply.code(400).send({ error: 'name is required' });
    return deps.displays.registerByName(name);
  });

  app.get('/api/displays', async () => deps.displays.list());

  app.get('/api/settings/safe-area', async () => readSafeArea(deps.settings));

  app.put<{ Body: Partial<SafeArea> }>('/api/settings/safe-area', async (req, reply) => {
    const merged: SafeArea = {
      ...readSafeArea(deps.settings),
      ...req.body,
    };
    if (Object.values(merged).some((n) => typeof n !== 'number' || Number.isNaN(n) || n < 0)) {
      return reply.code(400).send({ error: 'invalid safe-area values' });
    }
    deps.settings.set('safe_area_padding', JSON.stringify(merged));
    deps.onSettingsChanged?.();
    return merged;
  });

  registerSceneRoutes(app, {
    scenes: deps.scenes,
    displays: deps.displays,
    onSceneChanged: deps.onSceneChanged,
  });

  return app;
}
```

- [ ] **Step 2: Add safe-area carry-through to `SceneState`**

In `server/src/scenes/types.ts`, change the last line to:

```ts
export type SceneState = Omit<Scene, 'widgets'> & {
  widgets: WidgetState[];
  safeArea: { top: number; right: number; bottom: number; left: number };
};
```

In `server/src/scenes/assembler.ts`, change `buildSceneState` to accept the safe area:

```ts
export function buildSceneState(
  scene: Scene,
  safeArea: { top: number; right: number; bottom: number; left: number }
): SceneState {
  const widgets: WidgetState[] = scene.widgets.map((w) => ({ ...w, data: dataFor(w) }));
  return {
    id: scene.id,
    name: scene.name,
    layout: scene.layout,
    background: scene.background,
    typography: scene.typography,
    widgets,
    safeArea,
  };
}
```

Update `server/test/assembler.test.ts` to pass `DEFAULT_SAFE_AREA` (import from the new place):

```ts
import { buildSceneState } from '../src/scenes/assembler.js';
import { DEFAULT_SAFE_AREA } from '../src/api/http.js';
```

and replace `buildSceneState(baseScene)` with `buildSceneState(baseScene, DEFAULT_SAFE_AREA)` in every test. Add one extra assertion in the metadata test:

```ts
it('passes scene metadata through unchanged including safe area', () => {
  const state = buildSceneState(baseScene, DEFAULT_SAFE_AREA);
  expect(state.id).toBe('scene-1');
  expect(state.background).toEqual(baseScene.background);
  expect(state.typography).toEqual(baseScene.typography);
  expect(state.safeArea).toEqual(DEFAULT_SAFE_AREA);
});
```

- [ ] **Step 3: Update `server/src/api/ws.ts` to inject safe-area into pushed messages**

Add an import:

```ts
import type { SettingsRepo } from '../store/settings.js';
import { readSafeArea } from './http.js';
```

Extend `WsDeps`:

```ts
export type WsDeps = {
  displays: DisplaysRepo;
  scenes: ScenesRepo;
  settings: SettingsRepo;
};
```

Change `sceneMessageFor` to:

```ts
function sceneMessageFor(displayId: string, deps: WsDeps): string | null {
  const sceneId = activeSceneId(displayId, deps);
  if (!sceneId) return null;
  const scene = deps.scenes.get(sceneId);
  if (!scene) return null;
  const safeArea = readSafeArea(deps.settings);
  return JSON.stringify({ type: 'scene', state: buildSceneState(scene, safeArea) });
}
```

Add a method `pushSettingsChanged()` to the `CosmosWss` type and implementation that re-pushes scenes to all connected displays:

```ts
export type CosmosWss = WebSocketServer & {
  pushSceneTo(displayId: string): void;
  pushSettingsChanged(): void;
};
```

```ts
wss.pushSettingsChanged = () => {
  for (const displayId of sockets.keys()) wss.pushSceneTo(displayId);
};
```

- [ ] **Step 4: Write `server/test/safe-area.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { buildHttpApp, DEFAULT_SAFE_AREA } from '../src/api/http.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return {
    displays: createDisplaysRepo(db),
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
  };
}

describe('safe-area settings', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  beforeEach(async () => {
    app = await buildHttpApp(setup());
  });

  it('GET returns the default when unset', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/safe-area' });
    expect(res.json()).toEqual(DEFAULT_SAFE_AREA);
  });

  it('PUT merges and persists values', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/safe-area',
      payload: { top: 32, left: 24 },
    });
    expect(res.json()).toEqual({ ...DEFAULT_SAFE_AREA, top: 32, left: 24 });
    const get = await app.inject({ method: 'GET', url: '/api/settings/safe-area' });
    expect(get.json()).toEqual({ ...DEFAULT_SAFE_AREA, top: 32, left: 24 });
  });

  it('PUT rejects negative values', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/safe-area',
      payload: { top: -10 },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 5: Wire `settings` into the WS hub and `onSettingsChanged` in `index.ts`**

In `server/src/index.ts`, change the `attachWsHub` call to:

```ts
const wss = attachWsHub(app.server, { displays, scenes, settings });
```

And update `buildHttpApp` call to pass `onSettingsChanged`:

```ts
const app = await buildHttpApp({
  displays,
  settings,
  scenes,
  onSceneChanged,
  onSettingsChanged: () => wssRef?.pushSettingsChanged(),
});
```

Also update `server/test/ws.test.ts` and `server/test/ws.scene-push.test.ts` to pass `settings` into `attachWsHub`:

```ts
attachWsHub(app.server, { displays, scenes, settings });
```

- [ ] **Step 6: Display — add `safeArea` to SceneState type**

In `display/src/lib/types.ts`, change `SceneState`:

```ts
export type SceneState = {
  id: string;
  name: string;
  layout: Layout;
  background: Background;
  typography: Typography;
  widgets: WidgetState[];
  safeArea: { top: number; right: number; bottom: number; left: number };
};
```

- [ ] **Step 7: Display — apply padding in `SceneCanvas.svelte`**

Change the `.widget-layer` style attribute (currently `padding: 1rem;`) so the inline style sets it from the scene:

```svelte
<div
  class="widget-layer"
  style="grid-template-columns: repeat({scene.layout.cols}, 1fr);
         grid-template-rows: repeat({scene.layout.rows}, 1fr);
         padding: {scene.safeArea.top}px {scene.safeArea.right}px {scene.safeArea.bottom}px {scene.safeArea.left}px;"
>
```

Remove the `padding: 1rem;` from the `<style>` block's `.widget-layer` rule.

- [ ] **Step 8: Build & test**

```bash
npm --workspace server test
npm --workspace display run build
```

Expected: all server tests pass; display builds.

- [ ] **Step 9: Commit**

```bash
git add server/src/api/http.ts server/src/api/ws.ts server/src/scenes/types.ts server/src/scenes/assembler.ts server/src/index.ts server/test/safe-area.test.ts server/test/assembler.test.ts server/test/ws.test.ts server/test/ws.scene-push.test.ts display/src/lib/types.ts display/src/lib/scene/SceneCanvas.svelte
git commit -m "feat: add global safe-area padding setting plumbed end to end"
```

---

## Task 16: End-to-end smoke verification

Curl-driven scene creation, browser-driven render, manual visual confirmation, full test suite.

- [ ] **Step 1: Clean build everything**

```bash
rm -rf display/build server/dist data
npm run build
```

Expected: exit 0; `display/build/index.html` and `server/dist/index.js` exist.

- [ ] **Step 2: Start the server**

```bash
DB_PATH="$(pwd)/data/cosmos.db" npm --workspace server start
```
PowerShell:
```powershell
$env:DB_PATH = "$PWD/data/cosmos.db"; npm --workspace server start
```
Expected: log line `cosmos server listening on http://0.0.0.0:8099`.

- [ ] **Step 3: Register a display via curl**

```bash
curl -s -X POST http://localhost:8099/api/displays/register -H 'content-type: application/json' -d '{"name":"Living Room"}'
```
Expected: `{"id":"<uuid>","name":"Living Room","lastSeen":null,"defaultSceneId":null,"currentSceneId":null}`

- [ ] **Step 4: Create a "Morning" scene with one of every widget kind and an animated gradient**

```bash
curl -s -X POST http://localhost:8099/api/scenes \
  -H 'content-type: application/json' \
  -d '{
    "name": "Morning",
    "layout": { "cols": 12, "rows": 8, "items": [] },
    "background": {
      "type": "gradient",
      "colors": ["#1a1a2e", "#16213e", "#0f3460", "#e94560"],
      "speed": "slow",
      "style": "mesh"
    },
    "typography": { "font_family": "Inter", "font_scale": 1.0 },
    "widgets": [
      { "kind": "clock", "position": { "col": 1, "row": 1, "w": 6, "h": 3 }, "config": { "format": "24h" } },
      { "kind": "weather", "position": { "col": 7, "row": 1, "w": 6, "h": 3 }, "config": { "entity_id": "weather.home" } },
      { "kind": "entity_tile", "position": { "col": 1, "row": 4, "w": 4, "h": 2 }, "config": { "entity_id": "light.living_room" } },
      { "kind": "entity_tile", "position": { "col": 5, "row": 4, "w": 4, "h": 2 }, "config": { "entity_id": "sensor.outside_temp" } },
      { "kind": "entity_tile", "position": { "col": 9, "row": 4, "w": 4, "h": 2 }, "config": { "entity_id": "lock.front_door" } },
      { "kind": "entity_tile", "position": { "col": 1, "row": 6, "w": 6, "h": 2 }, "config": { "entity_id": "climate.thermostat" } },
      { "kind": "entity_tile", "position": { "col": 7, "row": 6, "w": 6, "h": 2 }, "config": { "entity_id": "cover.garage" } }
    ]
  }'
```
Expected: scene JSON with an `id`. Save the id.

- [ ] **Step 5: Assign the scene as the display's default**

```bash
curl -s -X POST 'http://localhost:8099/api/displays/Living%20Room/assign-scene' \
  -H 'content-type: application/json' \
  -d "{\"sceneId\":\"<paste id>\",\"makeDefault\":true}"
```
Expected: updated Display JSON with `defaultSceneId` set.

- [ ] **Step 6: Open in a browser**

Open `http://localhost:8099/` on a desktop browser. If onboarding form appears, enter `Living Room`. Confirm the scene renders:
- Animated mesh gradient background drifts continuously.
- Clock shows current time + date in Inter.
- Weather shows 18°C / Partly cloudy and a 5-day forecast.
- Five entity tiles render with the right type-specific UI (light with brightness + swatch, sensor with value+unit, lock pill, climate with temps, cover state).
- Layout uses a 12-column grid.

Reload the page — display name persists, scene re-renders without onboarding.

- [ ] **Step 7: Test live update via PUT**

Replace `<id>` with the scene id from Step 4. The payload below is the Step 4 payload with `"name"` changed to `"Morning v2"` and the background `"colors"` changed.

```bash
curl -s -X PUT http://localhost:8099/api/scenes/<id> \
  -H 'content-type: application/json' \
  -d '{
    "name": "Morning v2",
    "layout": { "cols": 12, "rows": 8, "items": [] },
    "background": {
      "type": "gradient",
      "colors": ["#3a1c71", "#d76d77", "#ffaf7b"],
      "speed": "slow",
      "style": "mesh"
    },
    "typography": { "font_family": "Inter", "font_scale": 1.0 },
    "widgets": [
      { "kind": "clock", "position": { "col": 1, "row": 1, "w": 6, "h": 3 }, "config": { "format": "24h" } },
      { "kind": "weather", "position": { "col": 7, "row": 1, "w": 6, "h": 3 }, "config": { "entity_id": "weather.home" } },
      { "kind": "entity_tile", "position": { "col": 1, "row": 4, "w": 4, "h": 2 }, "config": { "entity_id": "light.living_room" } },
      { "kind": "entity_tile", "position": { "col": 5, "row": 4, "w": 4, "h": 2 }, "config": { "entity_id": "sensor.outside_temp" } },
      { "kind": "entity_tile", "position": { "col": 9, "row": 4, "w": 4, "h": 2 }, "config": { "entity_id": "lock.front_door" } },
      { "kind": "entity_tile", "position": { "col": 1, "row": 6, "w": 6, "h": 2 }, "config": { "entity_id": "climate.thermostat" } },
      { "kind": "entity_tile", "position": { "col": 7, "row": 6, "w": 6, "h": 2 }, "config": { "entity_id": "cover.garage" } }
    ]
  }'
```
Expected: the open browser tab receives the updated scene push and re-renders without manual reload.

- [ ] **Step 8: Test safe-area padding**

```bash
curl -s -X PUT http://localhost:8099/api/settings/safe-area \
  -H 'content-type: application/json' \
  -d '{"top":48,"right":48,"bottom":48,"left":48}'
```
Expected: the browser tab re-renders with widgets pulled in 48px from each edge; gradient still bleeds to the edge.

- [ ] **Step 9: Persistence after restart**

Stop the server (Ctrl+C). Restart with the same `DB_PATH`. Reload the browser — the same scene should render (display + scene + assignment + safe-area all persisted).

- [ ] **Step 10: Reduced-motion check**

Toggle the OS-level reduced-motion preference (Windows: Settings → Accessibility → Visual effects → Animation effects off). Reload — gradient should be static (no drift).

- [ ] **Step 11: Run the full test suite**

```bash
npm test
```
Expected: all server tests pass.

- [ ] **Step 12: Final commit if anything drifted (likely nothing)**

```bash
git status
# if anything modified that should be tracked, commit; otherwise no-op
```

---

## Done criteria

- `npm test` is green for the server (display has no test suite yet).
- A real scene with real widgets renders in a browser, fed end-to-end through the server's REST API and pushed over WebSocket.
- Live REST updates push to connected displays without reload.
- Safe-area padding is configurable and applied.
- Animated gradient background drifts continuously and respects `prefers-reduced-motion`.
- All commits clean; working tree clean.

The next plan (Plan 3: Transition engine) replaces the abrupt scene swap on `pushSceneTo` with a choreographed Out → Bridge → In transition driven by per-scene transition descriptors.
