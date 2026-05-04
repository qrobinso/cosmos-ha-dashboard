# Cosmos Transition Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the abrupt scene swap from Plan 2 with a choreographed Out → Bridge → In transition. Each scene declares a default transition; per scene-pair overrides allow custom transitions for specific A→B swaps. Five built-in transitions ship with v1 (cross-fade, scale-fade, slide-up, slide-down, dissolve, gradient-morph). The display app runs a transition controller that intercepts incoming scene state and orchestrates the three-phase animation. `prefers-reduced-motion` collapses every transition to a 200ms cross-fade. Same-scene content updates remain abrupt — only "activate a different scene" triggers a transition.

**Architecture:** Server gets a `transitions` table with seeded built-ins, a `scenes.default_transition_id` column, and a `scene_transition_overrides(from_scene_id, to_scene_id, transition_id)` table. A new `POST /api/displays/:name/scene/activate {sceneId, transitionId?}` endpoint sets `displays.current_scene_id` and pushes the new scene with a resolved transition descriptor. The WS payload becomes `{type: 'scene', state, transition?}`. The display has a `TransitionController` that wraps `SceneCanvas`: on receiving a new scene with a transition, it keeps the old canvas mounted, applies an Out animation, swaps in the new canvas, runs an In animation, and unmounts the old. Background morph (the `gradient-morph` transition) interpolates background colors via CSS custom properties during the bridge phase. Reduced-motion bypasses all of this with a fixed 200ms cross-fade. Also: a small WS reconnect loop is added to the display client (called out as carry-over from Plan 2's review).

**Tech Stack:** Same as Plan 2.

---

## Common Conventions

- Branch off `main`: `git checkout main && git checkout -b cosmos-transition-engine`.
- TDD: failing test first, observe failure, implement, observe pass, commit.
- Conventional commits.
- Stage exactly the files each task lists. No scratch files.
- All file content in this plan is verbatim — copy as shown.

---

## File Structure

New files:

```
server/src/
  transitions/
    builtins.ts              # the 6 built-in transition descriptors as a const
    types.ts                 # TransitionDescriptor type
  store/
    transitions.ts           # transitions repo (read-only for v1) + scene_transition_overrides repo
  api/
    transitions.ts           # GET /api/transitions, GET /api/transitions/:id
display/src/
  lib/
    transitions/
      types.ts               # mirrors server TransitionDescriptor
      controller.ts          # TransitionController class — orchestrates Out/Bridge/In
      keyframes.css          # @keyframes blocks for the 5 motion transitions + reduced-motion fallback
      gradientMorph.ts       # helpers for color interpolation between scene backgrounds
    scene/
      TransitionStage.svelte # wraps SceneCanvas; applies in/out CSS classes
```

Modified files:

```
server/src/store/migrations.ts       # migration v3 (transitions, overrides, scene column)
server/src/store/scenes.ts           # add default_transition_id to Scene + accept on input
server/src/scenes/types.ts           # add `transition?: TransitionDescriptor` to push payload type
server/src/scenes/assembler.ts       # accept current_scene_id + scenes_repo + transitions_repo, resolve transition
server/src/api/http.ts               # mount transitions routes; new scene-activate endpoint
server/src/api/scenes.ts             # accept default_transition_id in SceneInput validation
server/src/api/ws.ts                 # plumb scenes/transitions repos into assembler call; track previous scene id per display
server/src/index.ts                  # wire the new repos
display/src/lib/types.ts             # mirror transition payload type
display/src/lib/ws.ts                # add reconnect with backoff; extend SceneMessage
display/src/routes/+page.svelte      # render via TransitionStage instead of SceneCanvas directly
display/src/routes/+layout.svelte    # import keyframes.css
CLAUDE.md                            # update with Plan 3 info
display/CLAUDE.md                    # update with transition controller info
server/CLAUDE.md                     # update with transitions module info
```

---

## Task 0: WS reconnect with backoff (carry-over from Plan 2 review)

Plan 2's final review flagged that the display has no reconnect logic. With transitions about to depend on a stable WS for state changes, this is now critical. Add a small reconnect loop with exponential backoff (max 30s).

**Files:**
- Modify: `display/src/lib/ws.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git checkout -b cosmos-transition-engine
```

- [ ] **Step 2: Replace `display/src/lib/ws.ts`**

```ts
import type { SceneState } from './types';

export type WelcomeMessage = { type: 'welcome'; displayId: string; message: string };
export type SceneMessage = { type: 'scene'; state: SceneState };
export type ErrorMessage = { type: 'error'; error: string };
export type ServerMessage = WelcomeMessage | SceneMessage | ErrorMessage;

export type CosmosConnection = {
  close(): void;
};

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export function connect(displayName: string, onMessage: (msg: ServerMessage) => void): CosmosConnection {
  let socket: WebSocket | null = null;
  let backoff = INITIAL_BACKOFF_MS;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function open() {
    if (closed) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      backoff = INITIAL_BACKOFF_MS;
      socket?.send(JSON.stringify({ type: 'hello', displayName }));
    });
    socket.addEventListener('message', (event) => {
      try {
        onMessage(JSON.parse(event.data) as ServerMessage);
      } catch {
        onMessage({ type: 'error', error: 'invalid server message' });
      }
    });
    socket.addEventListener('error', () => {
      onMessage({ type: 'error', error: 'websocket error' });
    });
    socket.addEventListener('close', (event) => {
      socket = null;
      if (closed) return;
      if (!event.wasClean) {
        onMessage({ type: 'error', error: 'connection lost — reconnecting' });
      }
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        open();
      }, backoff);
    });
  }

  open();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
```

- [ ] **Step 3: Update `display/src/routes/+page.svelte` to use the new return type**

Find the `let socket: WebSocket | null = null;` line and change it to:

```ts
let socket: { close(): void } | null = null;
```

The `connect(name, handleMessage)` call already returns the right type — only the variable's type needs widening.

- [ ] **Step 4: Build and commit**

```bash
npm --workspace display run build
git add display/src/lib/ws.ts display/src/routes/+page.svelte
git commit -m "fix(display): add ws reconnect with exponential backoff"
```

---

## Task 1: Migration v3 — transitions, overrides, scene column

**Files:**
- Modify: `server/src/store/migrations.ts`
- Modify: `server/test/migrations.test.ts`

- [ ] **Step 1: Add the failing test** — append to `server/test/migrations.test.ts` inside the existing `describe`:

```ts
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
    expect(versions.map((r) => r.version)).toEqual([1, 2, 3]);
  });

  it('migration v3 seeds the 6 built-in transitions', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const rows = db.prepare('SELECT name FROM transitions WHERE builtin = 1 ORDER BY name').all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(['cross-fade', 'dissolve', 'gradient-morph', 'scale-fade', 'slide-down', 'slide-up']);
  });
```

- [ ] **Step 2: Run the test, see it fail**

```bash
npm --workspace server test -- migrations
```

Expected: failures on the new transitions / overrides / default_transition_id assertions.

- [ ] **Step 3: Append migration v3 in `server/src/store/migrations.ts`**

Add this object as a new entry in the `migrations` array, after the v2 entry:

```ts
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
```

- [ ] **Step 4: Run tests — both new ones should pass**

```bash
npm --workspace server test -- migrations
```

Expected: 5 migration tests pass (was 3, +2 new).

- [ ] **Step 5: Run full suite**

```bash
npm --workspace server test
```

Expected: 46 tests pass (was 44, +2 new).

- [ ] **Step 6: Commit**

```bash
git add server/src/store/migrations.ts server/test/migrations.test.ts
git commit -m "feat(server): migration v3 — transitions, overrides, default_transition_id"
```

---

## Task 2: Transitions repository + descriptor types

**Files:**
- Create: `server/src/transitions/types.ts`
- Create: `server/src/store/transitions.ts`
- Create: `server/test/transitions.test.ts`

- [ ] **Step 1: Create `server/src/transitions/types.ts`**

```ts
export type TransitionPhase = {
  keyframes: string;
  duration_ms: number;
  easing: string;
  stagger_ms?: number;
};

export type TransitionDescriptor = {
  id: string;
  name: string;
  out: TransitionPhase;
  bridge: { background_morph: boolean; persist_widget_kinds?: string[] };
  in: TransitionPhase;
};
```

- [ ] **Step 2: Write the failing test `server/test/transitions.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return { db, transitions: createTransitionsRepo(db), overrides: createOverridesRepo(db) };
}

describe('transitions repo', () => {
  it('list returns all 6 built-ins', () => {
    const ctx = setup();
    const all = ctx.transitions.list();
    expect(all.length).toBe(6);
    expect(all.map((t) => t.name).sort()).toEqual([
      'cross-fade', 'dissolve', 'gradient-morph', 'scale-fade', 'slide-down', 'slide-up',
    ]);
    for (const t of all) {
      expect(t.out.keyframes).toBeTruthy();
      expect(t.in.keyframes).toBeTruthy();
      expect(typeof t.bridge.background_morph).toBe('boolean');
    }
  });

  it('getById returns the descriptor or null', () => {
    const ctx = setup();
    const got = ctx.transitions.getById('builtin-cross-fade');
    expect(got?.name).toBe('cross-fade');
    expect(ctx.transitions.getById('not-real')).toBeNull();
  });

  it('getByName returns the descriptor or null', () => {
    const ctx = setup();
    expect(ctx.transitions.getByName('gradient-morph')?.id).toBe('builtin-gradient-morph');
    expect(ctx.transitions.getByName('not-real')).toBeNull();
  });
});

describe('scene_transition_overrides repo', () => {
  it('set + get round-trip', () => {
    const ctx = setup();
    // Create two scenes so the FKs are satisfied
    ctx.db
      .prepare(
        `INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`
      )
      .run('s1', 'A', '{}', '{}', '{}');
    ctx.db
      .prepare(
        `INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`
      )
      .run('s2', 'B', '{}', '{}', '{}');
    ctx.overrides.set('s1', 's2', 'builtin-dissolve');
    expect(ctx.overrides.get('s1', 's2')).toBe('builtin-dissolve');
    expect(ctx.overrides.get('s2', 's1')).toBeNull();
  });

  it('set is upsert (changing the override replaces it)', () => {
    const ctx = setup();
    ctx.db
      .prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`)
      .run('s1', 'A', '{}', '{}', '{}');
    ctx.db
      .prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`)
      .run('s2', 'B', '{}', '{}', '{}');
    ctx.overrides.set('s1', 's2', 'builtin-dissolve');
    ctx.overrides.set('s1', 's2', 'builtin-slide-up');
    expect(ctx.overrides.get('s1', 's2')).toBe('builtin-slide-up');
  });

  it('clear removes the override', () => {
    const ctx = setup();
    ctx.db
      .prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`)
      .run('s1', 'A', '{}', '{}', '{}');
    ctx.db
      .prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`)
      .run('s2', 'B', '{}', '{}', '{}');
    ctx.overrides.set('s1', 's2', 'builtin-dissolve');
    ctx.overrides.clear('s1', 's2');
    expect(ctx.overrides.get('s1', 's2')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test, see it fail**

```bash
npm --workspace server test -- transitions
```

- [ ] **Step 4: Implement `server/src/store/transitions.ts`**

```ts
import type { DB } from './db.js';
import type { TransitionDescriptor } from '../transitions/types.js';

export type TransitionsRepo = {
  list(): TransitionDescriptor[];
  getById(id: string): TransitionDescriptor | null;
  getByName(name: string): TransitionDescriptor | null;
};

export type OverridesRepo = {
  get(fromSceneId: string, toSceneId: string): string | null;
  set(fromSceneId: string, toSceneId: string, transitionId: string): void;
  clear(fromSceneId: string, toSceneId: string): void;
};

type TRow = { id: string; name: string; descriptor_json: string };

function rowToTransition(r: TRow): TransitionDescriptor {
  return JSON.parse(r.descriptor_json) as TransitionDescriptor;
}

export function createTransitionsRepo(db: DB): TransitionsRepo {
  const all = db.prepare<[], TRow>('SELECT id, name, descriptor_json FROM transitions ORDER BY name');
  const byId = db.prepare<[string], TRow>('SELECT id, name, descriptor_json FROM transitions WHERE id = ?');
  const byName = db.prepare<[string], TRow>('SELECT id, name, descriptor_json FROM transitions WHERE name = ?');
  return {
    list() {
      return all.all().map(rowToTransition);
    },
    getById(id) {
      const r = byId.get(id);
      return r ? rowToTransition(r) : null;
    },
    getByName(name) {
      const r = byName.get(name);
      return r ? rowToTransition(r) : null;
    },
  };
}

export function createOverridesRepo(db: DB): OverridesRepo {
  const select = db.prepare<[string, string], { transition_id: string }>(
    'SELECT transition_id FROM scene_transition_overrides WHERE from_scene_id = ? AND to_scene_id = ?'
  );
  const upsert = db.prepare(
    `INSERT INTO scene_transition_overrides (from_scene_id, to_scene_id, transition_id)
     VALUES (?, ?, ?)
     ON CONFLICT(from_scene_id, to_scene_id) DO UPDATE SET transition_id = excluded.transition_id`
  );
  const remove = db.prepare(
    'DELETE FROM scene_transition_overrides WHERE from_scene_id = ? AND to_scene_id = ?'
  );
  return {
    get(fromSceneId, toSceneId) {
      const r = select.get(fromSceneId, toSceneId);
      return r ? r.transition_id : null;
    },
    set(fromSceneId, toSceneId, transitionId) {
      upsert.run(fromSceneId, toSceneId, transitionId);
    },
    clear(fromSceneId, toSceneId) {
      remove.run(fromSceneId, toSceneId);
    },
  };
}
```

- [ ] **Step 5: Run the tests**

```bash
npm --workspace server test -- transitions
```

Expected: 6 tests pass (3 transitions + 3 overrides).

- [ ] **Step 6: Commit**

```bash
git add server/src/transitions/types.ts server/src/store/transitions.ts server/test/transitions.test.ts
git commit -m "feat(server): add transitions repo + scene-pair overrides repo"
```

---

## Task 3: Extend Scene + ScenesRepo with default_transition_id

**Files:**
- Modify: `server/src/store/scenes.ts`
- Modify: `server/test/scenes.test.ts`

- [ ] **Step 1: Append a test inside the existing `describe('scenes repo', ...)` block in `server/test/scenes.test.ts`**

```ts
  it('create + update accept and persist default_transition_id', () => {
    const ctx = setup();
    const created = ctx.scenes.create({ ...sample, defaultTransitionId: 'builtin-cross-fade' });
    expect(created.defaultTransitionId).toBe('builtin-cross-fade');
    const fetched = ctx.scenes.get(created.id);
    expect(fetched?.defaultTransitionId).toBe('builtin-cross-fade');
    const updated = ctx.scenes.update(created.id, { ...sample, defaultTransitionId: 'builtin-dissolve' });
    expect(updated.defaultTransitionId).toBe('builtin-dissolve');
  });

  it('default_transition_id is null when not provided', () => {
    const ctx = setup();
    const created = ctx.scenes.create(sample);
    expect(created.defaultTransitionId).toBeNull();
  });
```

- [ ] **Step 2: Run the test, see it fail**

```bash
npm --workspace server test -- scenes
```

Expected: failures because `defaultTransitionId` doesn't exist on Scene/SceneInput.

- [ ] **Step 3: Modify `server/src/store/scenes.ts`**

Add `defaultTransitionId: string | null` to the `Scene` type and `defaultTransitionId?: string | null` to `SceneInput`. Then update SQL + the persist/load functions:

Replace the `Scene` type:

```ts
export type Scene = {
  id: string;
  name: string;
  layout: Layout;
  background: Background;
  typography: Typography;
  defaultTransitionId: string | null;
  widgets: Widget[];
};
```

Replace the `SceneInput` type:

```ts
export type SceneInput = Omit<Scene, 'id' | 'widgets' | 'defaultTransitionId'> & {
  defaultTransitionId?: string | null;
  widgets: Omit<Widget, 'id'>[];
};
```

Replace the `SceneRow` type:

```ts
type SceneRow = {
  id: string;
  name: string;
  layout_json: string;
  background_json: string;
  typography_json: string;
  default_transition_id: string | null;
};
```

Replace `rowToScene`:

```ts
function rowToScene(s: SceneRow, widgets: Widget[]): Scene {
  return {
    id: s.id,
    name: s.name,
    layout: JSON.parse(s.layout_json),
    background: JSON.parse(s.background_json),
    typography: JSON.parse(s.typography_json),
    defaultTransitionId: s.default_transition_id,
    widgets,
  };
}
```

Replace the prepared statements that touch scenes:

```ts
  const insertScene = db.prepare(
    'INSERT INTO scenes (id, name, layout_json, background_json, typography_json, default_transition_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const updateScene = db.prepare(
    "UPDATE scenes SET name = ?, layout_json = ?, background_json = ?, typography_json = ?, default_transition_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  );
  const selectSceneById = db.prepare<[string], SceneRow>(
    'SELECT id, name, layout_json, background_json, typography_json, default_transition_id FROM scenes WHERE id = ?'
  );
  const selectAllScenes = db.prepare<[], SceneRow>(
    'SELECT id, name, layout_json, background_json, typography_json, default_transition_id FROM scenes ORDER BY name'
  );
  const selectAssignedScenes = db.prepare<[string], SceneRow>(
    `SELECT s.id, s.name, s.layout_json, s.background_json, s.typography_json, s.default_transition_id
     FROM scenes s
     JOIN scenes_displays sd ON sd.scene_id = s.id
     WHERE sd.display_id = ?
     ORDER BY s.name`
  );
```

Replace the `persist` function:

```ts
  function persist(input: SceneInput, sceneId: string, isUpdate: boolean): Scene {
    db.exec('BEGIN');
    try {
      const layout_json = JSON.stringify(input.layout);
      const background_json = JSON.stringify(input.background);
      const typography_json = JSON.stringify(input.typography);
      const defaultTransitionId = input.defaultTransitionId ?? null;
      if (isUpdate) {
        updateScene.run(input.name, layout_json, background_json, typography_json, defaultTransitionId, sceneId);
      } else {
        insertScene.run(sceneId, input.name, layout_json, background_json, typography_json, defaultTransitionId);
      }
      const widgets = writeWidgets(sceneId, input.widgets);
      db.exec('COMMIT');
      return {
        id: sceneId,
        name: input.name,
        layout: input.layout,
        background: input.background,
        typography: input.typography,
        defaultTransitionId,
        widgets,
      };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
```

- [ ] **Step 4: Run the test**

```bash
npm --workspace server test -- scenes
```

Expected: 9 scenes-repo tests pass (7 existing + 2 new).

- [ ] **Step 5: Run full suite — make sure http and ws tests still pass with the additive field**

```bash
npm --workspace server test
```

Expected: all tests pass (count goes up by 2).

- [ ] **Step 6: Commit**

```bash
git add server/src/store/scenes.ts server/test/scenes.test.ts
git commit -m "feat(server): add default_transition_id to Scene"
```

---

## Task 4: Resolve transition in scene push + activate-scene endpoint

The server's job at scene-push time:

1. Read display's previous scene id (from in-memory map kept by the WS hub — we add this).
2. Read display's new active scene id.
3. Resolve the transition: `overrides.get(prev, next) ?? next.defaultTransitionId ?? null`.
4. Push `{type: 'scene', state, transition?: TransitionDescriptor}`. Omit transition for the very first scene a display sees (no "from" to transition from).
5. Update the per-display "previous scene" to the new id.

A new endpoint `POST /api/displays/:name/scene/activate {sceneId, transitionId?}` sets `displays.current_scene_id = sceneId`, optionally overrides the resolved transition, and triggers a push.

**Files:**
- Modify: `server/src/scenes/types.ts`
- Modify: `server/src/scenes/assembler.ts`
- Modify: `server/src/api/ws.ts`
- Modify: `server/src/api/http.ts`
- Modify: `server/src/api/scenes.ts`
- Modify: `server/src/index.ts`
- Modify: `server/test/assembler.test.ts`
- Modify: `server/test/ws.test.ts`
- Modify: `server/test/ws.scene-push.test.ts`
- Create: `server/test/activate-scene.test.ts`

- [ ] **Step 1: Update `server/src/scenes/types.ts`** — add transition to the push payload type:

```ts
import type { Scene, Widget } from '../store/scenes.js';
import type { TransitionDescriptor } from '../transitions/types.js';

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

export type SceneState = Omit<Scene, 'widgets'> & {
  widgets: WidgetState[];
  safeArea: { top: number; right: number; bottom: number; left: number };
};

export type ScenePushPayload = {
  type: 'scene';
  state: SceneState;
  transition?: TransitionDescriptor;
};
```

- [ ] **Step 2: Update `server/src/scenes/assembler.ts`** — `buildSceneState` is unchanged. Add a new `assemblePush` function:

```ts
import type { Scene, Widget } from '../store/scenes.js';
import type { SceneState, WidgetState, WidgetData, ScenePushPayload } from './types.js';
import type { TransitionDescriptor } from '../transitions/types.js';
import type { TransitionsRepo, OverridesRepo } from '../store/transitions.js';
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
    defaultTransitionId: scene.defaultTransitionId,
    widgets,
    safeArea,
  };
}

export type AssemblePushArgs = {
  scene: Scene;
  safeArea: { top: number; right: number; bottom: number; left: number };
  previousSceneId: string | null;
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
  explicitTransitionId?: string | null;
};

export function resolveTransition(args: AssemblePushArgs): TransitionDescriptor | null {
  if (args.previousSceneId === null) return null;
  if (args.previousSceneId === args.scene.id) return null;
  if (args.explicitTransitionId) {
    return args.transitions.getById(args.explicitTransitionId);
  }
  const overrideId = args.overrides.get(args.previousSceneId, args.scene.id);
  if (overrideId) return args.transitions.getById(overrideId);
  if (args.scene.defaultTransitionId) return args.transitions.getById(args.scene.defaultTransitionId);
  return null;
}

export function assemblePush(args: AssemblePushArgs): ScenePushPayload {
  const state = buildSceneState(args.scene, args.safeArea);
  const transition = resolveTransition(args);
  return transition ? { type: 'scene', state, transition } : { type: 'scene', state };
}
```

- [ ] **Step 3: Update `server/src/api/ws.ts`** — track previous scene id per display in memory; thread the transition through every push:

```ts
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { DisplaysRepo } from '../store/displays.js';
import type { ScenesRepo } from '../store/scenes.js';
import type { SettingsRepo } from '../store/settings.js';
import type { TransitionsRepo, OverridesRepo } from '../store/transitions.js';
import { assemblePush } from '../scenes/assembler.js';
import { readSafeArea } from './http.js';

export type WsDeps = {
  displays: DisplaysRepo;
  scenes: ScenesRepo;
  settings: SettingsRepo;
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
};

export type CosmosWss = WebSocketServer & {
  pushSceneTo(displayId: string, opts?: { explicitTransitionId?: string | null }): void;
  pushSettingsChanged(): void;
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

export function attachWsHub(server: Server, deps: WsDeps): CosmosWss {
  const wss = new WebSocketServer({ server, path: '/ws' }) as CosmosWss;
  const sockets = new Map<string, Set<WebSocket>>();
  const lastSceneByDisplay = new Map<string, string>();

  function buildPayload(displayId: string, explicitTransitionId?: string | null): string | null {
    const sceneId = activeSceneId(displayId, deps);
    if (!sceneId) return null;
    const scene = deps.scenes.get(sceneId);
    if (!scene) return null;
    const previousSceneId = lastSceneByDisplay.get(displayId) ?? null;
    const safeArea = readSafeArea(deps.settings);
    const payload = assemblePush({
      scene,
      safeArea,
      previousSceneId,
      transitions: deps.transitions,
      overrides: deps.overrides,
      explicitTransitionId,
    });
    lastSceneByDisplay.set(displayId, scene.id);
    return JSON.stringify(payload);
  }

  wss.on('connection', (socket: WebSocket) => {
    let ownDisplayId: string | null = null;
    socket.on('close', () => {
      if (ownDisplayId) sockets.get(ownDisplayId)?.delete(socket);
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

      // Hello-time push has no previous scene by definition, so no transition.
      lastSceneByDisplay.delete(display.id);
      const payload = buildPayload(display.id);
      if (payload) socket.send(payload);
    });
  });

  wss.pushSceneTo = (displayId, opts) => {
    const set = sockets.get(displayId);
    if (!set || set.size === 0) return;
    const payload = buildPayload(displayId, opts?.explicitTransitionId);
    if (!payload) return;
    for (const s of set) {
      if (s.readyState === s.OPEN) s.send(payload);
    }
  };

  wss.pushSettingsChanged = () => {
    for (const displayId of sockets.keys()) wss.pushSceneTo(displayId);
  };

  return wss;
}
```

- [ ] **Step 4: Add scene/activate endpoint and accept default_transition_id in scene input**

In `server/src/api/scenes.ts`, modify `isValidSceneInput` to accept the optional field (no behaviour change — `defaultTransitionId` is just allowed to pass through). The existing function only checks the required fields, so adding an optional field requires no change to the validator. But add a comment so future readers know it's intentional:

```ts
function isValidSceneInput(body: unknown): body is SceneInput {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || b.name.trim() === '') return false;
  if (typeof b.layout !== 'object' || b.layout === null) return false;
  if (typeof b.background !== 'object' || b.background === null) return false;
  if (typeof b.typography !== 'object' || b.typography === null) return false;
  if (!Array.isArray(b.widgets)) return false;
  // defaultTransitionId is optional; the repo accepts string | null | undefined.
  return true;
}
```

In `server/src/api/http.ts`, add a new `HttpDeps.transitions` (`TransitionsRepo`) and `HttpDeps.overrides` (`OverridesRepo`), pass them to `registerSceneRoutes` (Task 5 will add a transitions router; for now they are unused in routes but are part of HttpDeps). Then add the activate-scene endpoint:

In `server/src/api/scenes.ts`, extend `SceneRoutesDeps`:

```ts
export type SceneRoutesDeps = {
  scenes: ScenesRepo;
  displays: DisplaysRepo;
  onSceneChanged?: (displayId: string, opts?: { explicitTransitionId?: string | null }) => void;
};
```

And add the activate route inside `registerSceneRoutes`:

```ts
  app.post<{
    Params: { name: string };
    Body: { sceneId?: unknown; transitionId?: unknown };
  }>(
    '/api/displays/:name/scene/activate',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const sceneId = typeof req.body?.sceneId === 'string' ? req.body.sceneId : null;
      if (!sceneId) return reply.code(400).send({ error: 'sceneId required' });
      const scene = deps.scenes.get(sceneId);
      if (!scene) return reply.code(404).send({ error: 'scene not found' });
      const transitionId =
        typeof req.body?.transitionId === 'string' ? req.body.transitionId : null;
      deps.displays.setCurrentScene(display.id, sceneId);
      deps.onSceneChanged?.(display.id, { explicitTransitionId: transitionId });
      return deps.displays.getById(display.id);
    }
  );
```

(`assign-scene` is unchanged — it still sets defaultSceneId and triggers a push if the active scene effectively changes.)

- [ ] **Step 5: Update `server/src/index.ts`** to wire the new repos:

```ts
import { config } from './config.js';
import { openDatabase } from './store/db.js';
import { runMigrations } from './store/migrations.js';
import { createDisplaysRepo } from './store/displays.js';
import { createSettingsRepo } from './store/settings.js';
import { createScenesRepo } from './store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from './store/transitions.js';
import { buildHttpApp } from './api/http.js';
import { attachWsHub } from './api/ws.js';
import { registerStatic } from './static.js';

async function main() {
  const db = openDatabase(config.dbPath);
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);

  let wssRef: ReturnType<typeof attachWsHub> | null = null;
  const onSceneChanged = (displayId: string, opts?: { explicitTransitionId?: string | null }) =>
    wssRef?.pushSceneTo(displayId, opts);

  const app = await buildHttpApp({
    displays,
    settings,
    scenes,
    transitions,
    overrides,
    onSceneChanged,
    onSettingsChanged: () => wssRef?.pushSettingsChanged(),
  });
  await registerStatic(app, config.staticDir);
  const wss = attachWsHub(app.server, { displays, scenes, settings, transitions, overrides });
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

- [ ] **Step 6: Update `server/src/api/http.ts`** to thread the new deps through:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { DisplaysRepo } from '../store/displays.js';
import type { SettingsRepo } from '../store/settings.js';
import type { ScenesRepo } from '../store/scenes.js';
import type { TransitionsRepo, OverridesRepo } from '../store/transitions.js';
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
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
  onSceneChanged?: (displayId: string, opts?: { explicitTransitionId?: string | null }) => void;
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
    const merged: SafeArea = { ...readSafeArea(deps.settings), ...req.body };
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

- [ ] **Step 7: Update existing test setups to include the new deps**

In `server/test/assembler.test.ts`, replace `buildSceneState(baseScene, DEFAULT_SAFE_AREA)` calls with their existing form (no signature change). Add a new `describe('assemblePush', ...)` block at the bottom:

```ts
import { assemblePush, resolveTransition } from '../src/scenes/assembler.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';

function reposFor() {
  const db = new Database(':memory:');
  runMigrations(db);
  return { transitions: createTransitionsRepo(db), overrides: createOverridesRepo(db) };
}

describe('assemblePush', () => {
  it('omits transition when previousSceneId is null', () => {
    const { transitions, overrides } = reposFor();
    const payload = assemblePush({ scene: baseScene, safeArea: DEFAULT_SAFE_AREA, previousSceneId: null, transitions, overrides });
    expect(payload.transition).toBeUndefined();
  });

  it('omits transition when previous and new are the same scene', () => {
    const { transitions, overrides } = reposFor();
    const payload = assemblePush({ scene: baseScene, safeArea: DEFAULT_SAFE_AREA, previousSceneId: baseScene.id, transitions, overrides });
    expect(payload.transition).toBeUndefined();
  });

  it('uses scene.defaultTransitionId when no override exists', () => {
    const { transitions, overrides } = reposFor();
    const sceneWithDefault = { ...baseScene, id: 'scene-2', defaultTransitionId: 'builtin-cross-fade' };
    const payload = assemblePush({ scene: sceneWithDefault, safeArea: DEFAULT_SAFE_AREA, previousSceneId: 'scene-1', transitions, overrides });
    expect(payload.transition?.name).toBe('cross-fade');
  });

  it('uses overrides.get when a scene-pair override exists', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`).run('scene-1', 'A', '{}', '{}', '{}');
    db.prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`).run('scene-2', 'B', '{}', '{}', '{}');
    const transitions = createTransitionsRepo(db);
    const overrides = createOverridesRepo(db);
    overrides.set('scene-1', 'scene-2', 'builtin-dissolve');
    const sceneB = { ...baseScene, id: 'scene-2', defaultTransitionId: 'builtin-cross-fade' };
    const payload = assemblePush({ scene: sceneB, safeArea: DEFAULT_SAFE_AREA, previousSceneId: 'scene-1', transitions, overrides });
    expect(payload.transition?.name).toBe('dissolve');
  });

  it('explicitTransitionId takes precedence', () => {
    const { transitions, overrides } = reposFor();
    const sceneB = { ...baseScene, id: 'scene-2', defaultTransitionId: 'builtin-cross-fade' };
    const payload = assemblePush({
      scene: sceneB, safeArea: DEFAULT_SAFE_AREA, previousSceneId: 'scene-1',
      transitions, overrides, explicitTransitionId: 'builtin-slide-up',
    });
    expect(payload.transition?.name).toBe('slide-up');
  });
});
```

- [ ] **Step 8: Update `server/test/ws.test.ts` and `server/test/ws.scene-push.test.ts`** to pass the new deps into `attachWsHub`:

```ts
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
```

In `startServer()`:

```ts
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  const app = await buildHttpApp({ displays, settings, scenes, transitions, overrides });
  attachWsHub(app.server, { displays, scenes, settings, transitions, overrides });
```

Also `http.test.ts` and `scenes.api.test.ts` setup functions:

```ts
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  return buildHttpApp({ displays, settings, scenes, transitions, overrides });
```

And `safe-area.test.ts` similarly.

- [ ] **Step 9: Write `server/test/activate-scene.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';

const sample = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid' as const, color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [],
};

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  return { displays, settings, scenes, transitions, overrides };
}

describe('POST /api/displays/:name/scene/activate', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let calls: Array<{ displayId: string; opts?: { explicitTransitionId?: string | null } }>;
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    calls = [];
    app = await buildHttpApp({ ...ctx, onSceneChanged: (id, opts) => calls.push({ displayId: id, opts }) });
  });

  it('sets currentSceneId and triggers onSceneChanged with no explicit transition', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/activate`,
      payload: { sceneId: scene.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().currentSceneId).toBe(scene.id);
    expect(calls.length).toBe(1);
    expect(calls[0].displayId).toBe(display.id);
    expect(calls[0].opts?.explicitTransitionId).toBeNull();
  });

  it('passes explicit transitionId through', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/activate`,
      payload: { sceneId: scene.id, transitionId: 'builtin-slide-up' },
    });
    expect(calls[0].opts?.explicitTransitionId).toBe('builtin-slide-up');
  });

  it('returns 404 for missing display', async () => {
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/Nope/scene/activate',
      payload: { sceneId: scene.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for missing scene', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/activate`,
      payload: { sceneId: 'no-such-scene' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when sceneId is missing', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/activate`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 10: Run the full suite**

```bash
npm --workspace server test
```

Expected: all green. New tests: ~5 from activate-scene + ~5 from assembler. Total roughly 56.

- [ ] **Step 11: Commit**

```bash
git add server/src/scenes/types.ts server/src/scenes/assembler.ts server/src/api/ws.ts server/src/api/http.ts server/src/api/scenes.ts server/src/index.ts server/test/assembler.test.ts server/test/ws.test.ts server/test/ws.scene-push.test.ts server/test/http.test.ts server/test/scenes.api.test.ts server/test/safe-area.test.ts server/test/activate-scene.test.ts
git commit -m "feat(server): assemble transition descriptor on push + add scene activate endpoint"
```

---

## Task 5: Transitions REST routes

A small read-mostly endpoint for the editor (Plan 5) to discover available transitions. Also lets users curl them while exploring.

**Files:**
- Create: `server/src/api/transitions.ts`
- Modify: `server/src/api/http.ts` (mount the new router)
- Create: `server/test/transitions.api.test.ts`

- [ ] **Step 1: Write the failing test `server/test/transitions.api.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return {
    displays: createDisplaysRepo(db),
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
  };
}

describe('transitions REST API', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  beforeEach(async () => {
    app = await buildHttpApp(setup());
  });

  it('GET /api/transitions returns all 6 built-ins', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transitions' });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['cross-fade', 'dissolve', 'gradient-morph', 'scale-fade', 'slide-down', 'slide-up']);
  });

  it('GET /api/transitions/:id returns one descriptor', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transitions/builtin-dissolve' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('dissolve');
  });

  it('GET /api/transitions/:id returns 404 for missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transitions/no-such' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run, see fail**

```bash
npm --workspace server test -- transitions.api
```

- [ ] **Step 3: Create `server/src/api/transitions.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { TransitionsRepo } from '../store/transitions.js';

export function registerTransitionRoutes(app: FastifyInstance, transitions: TransitionsRepo): void {
  app.get('/api/transitions', async () => transitions.list());

  app.get<{ Params: { id: string } }>('/api/transitions/:id', async (req, reply) => {
    const t = transitions.getById(req.params.id);
    if (!t) return reply.code(404).send({ error: 'not found' });
    return t;
  });
}
```

- [ ] **Step 4: Mount it in `server/src/api/http.ts`** — add import and call inside `buildHttpApp`:

```ts
import { registerTransitionRoutes } from './transitions.js';
```

Inside `buildHttpApp`, after the safe-area routes but before `registerSceneRoutes`:

```ts
  registerTransitionRoutes(app, deps.transitions);
```

- [ ] **Step 5: Run tests**

```bash
npm --workspace server test
```

Expected: 3 new tests pass; full suite green.

- [ ] **Step 6: Commit**

```bash
git add server/src/api/transitions.ts server/src/api/http.ts server/test/transitions.api.test.ts
git commit -m "feat(server): expose transitions via /api/transitions"
```

---

## Task 6: Display — types + transition controller skeleton

The controller is a small state machine. It accepts `(currentScene, nextScene, transition?)` and yields phases the view can react to. Implementation keeps the old SceneCanvas mounted while the new one mounts; both have CSS classes that drive the keyframe animations.

**Files:**
- Modify: `display/src/lib/types.ts` (add transition types)
- Create: `display/src/lib/transitions/types.ts`
- Create: `display/src/lib/transitions/controller.ts`

- [ ] **Step 1: Create `display/src/lib/transitions/types.ts`**

```ts
export type TransitionPhase = {
  keyframes: string;
  duration_ms: number;
  easing: string;
  stagger_ms?: number;
};

export type TransitionDescriptor = {
  id: string;
  name: string;
  out: TransitionPhase;
  bridge: { background_morph: boolean; persist_widget_kinds?: string[] };
  in: TransitionPhase;
};

export type StagePhase = 'idle' | 'out' | 'bridge' | 'in';

export type StageState = {
  phase: StagePhase;
  outgoingScene: import('../types').SceneState | null;
  incomingScene: import('../types').SceneState | null;
  transition: TransitionDescriptor | null;
};
```

- [ ] **Step 2: Update `display/src/lib/types.ts`** — add the transition field on `SceneMessage`:

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
  defaultTransitionId: string | null;
  widgets: WidgetState[];
  safeArea: { top: number; right: number; bottom: number; left: number };
};
```

Then update `display/src/lib/ws.ts` so `SceneMessage` carries the optional transition:

```ts
import type { SceneState } from './types';
import type { TransitionDescriptor } from './transitions/types';

export type WelcomeMessage = { type: 'welcome'; displayId: string; message: string };
export type SceneMessage = { type: 'scene'; state: SceneState; transition?: TransitionDescriptor };
export type ErrorMessage = { type: 'error'; error: string };
export type ServerMessage = WelcomeMessage | SceneMessage | ErrorMessage;
```

(The rest of `ws.ts` from Task 0 is unchanged.)

- [ ] **Step 3: Create `display/src/lib/transitions/controller.ts`**

```ts
import type { SceneState } from '../types';
import type { StageState, TransitionDescriptor } from './types';

export type StageListener = (s: StageState) => void;

export class TransitionController {
  private state: StageState = {
    phase: 'idle',
    outgoingScene: null,
    incomingScene: null,
    transition: null,
  };
  private listeners = new Set<StageListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  subscribe(fn: StageListener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  current(): StageState {
    return this.state;
  }

  receive(scene: SceneState, transition: TransitionDescriptor | null): void {
    if (!transition || !this.state.incomingScene) {
      // First scene of the session, OR an instant swap (no transition).
      this.set({ phase: 'idle', outgoingScene: null, incomingScene: scene, transition: null });
      return;
    }
    if (transition && this.shouldReduceMotion()) {
      transition = REDUCED_MOTION_TRANSITION;
    }
    // Begin Out phase: keep outgoing visible, animate it out
    this.cancelTimer();
    this.set({
      phase: 'out',
      outgoingScene: this.state.incomingScene,
      incomingScene: scene,
      transition,
    });
    this.timer = setTimeout(() => this.advanceToBridge(), transition.out.duration_ms);
  }

  private advanceToBridge(): void {
    if (!this.state.transition) return;
    this.set({ ...this.state, phase: 'bridge' });
    // Bridge is essentially zero-duration in v1; immediately advance to In.
    this.timer = setTimeout(() => this.advanceToIn(), 16);
  }

  private advanceToIn(): void {
    if (!this.state.transition) return;
    this.set({ ...this.state, phase: 'in' });
    this.timer = setTimeout(() => this.complete(), this.state.transition.in.duration_ms);
  }

  private complete(): void {
    this.set({
      phase: 'idle',
      outgoingScene: null,
      incomingScene: this.state.incomingScene,
      transition: null,
    });
  }

  private set(next: StageState): void {
    this.state = next;
    for (const fn of this.listeners) fn(next);
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private shouldReduceMotion(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  }
}

export const REDUCED_MOTION_TRANSITION: TransitionDescriptor = {
  id: 'reduced-motion-fallback',
  name: 'reduced-motion',
  out: { keyframes: 'cosmos-out-fade', duration_ms: 100, easing: 'linear' },
  bridge: { background_morph: false },
  in: { keyframes: 'cosmos-in-fade', duration_ms: 100, easing: 'linear' },
};
```

- [ ] **Step 4: Build to confirm TS compiles**

```bash
npm --workspace display run build
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add display/src/lib/transitions/types.ts display/src/lib/transitions/controller.ts display/src/lib/types.ts display/src/lib/ws.ts
git commit -m "feat(display): add TransitionController state machine"
```

---

## Task 7: Display — keyframes + TransitionStage component

**Files:**
- Create: `display/src/lib/transitions/keyframes.css`
- Create: `display/src/lib/scene/TransitionStage.svelte`
- Modify: `display/src/routes/+page.svelte` (use TransitionStage)
- Modify: `display/src/routes/+layout.svelte` (import keyframes.css)

- [ ] **Step 1: Create `display/src/lib/transitions/keyframes.css`**

```css
@keyframes cosmos-out-fade {
  from { opacity: 1; }
  to { opacity: 0; }
}
@keyframes cosmos-in-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes cosmos-out-scale-fade {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.96); }
}
@keyframes cosmos-in-scale-fade {
  from { opacity: 0; transform: scale(1.04); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes cosmos-out-slide-up {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-2rem); }
}
@keyframes cosmos-in-slide-up {
  from { opacity: 0; transform: translateY(2rem); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes cosmos-out-slide-down {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(2rem); }
}
@keyframes cosmos-in-slide-down {
  from { opacity: 0; transform: translateY(-2rem); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes cosmos-out-dissolve {
  from { opacity: 1; filter: blur(0); }
  to { opacity: 0; filter: blur(0.4rem); }
}
@keyframes cosmos-in-dissolve {
  from { opacity: 0; filter: blur(0.4rem); }
  to { opacity: 1; filter: blur(0); }
}

.cosmos-stage-layer {
  position: fixed;
  inset: 0;
  will-change: opacity, transform, filter;
}

.cosmos-stage-layer[data-phase='out'] {
  animation-name: var(--cosmos-out-keyframes);
  animation-duration: var(--cosmos-out-duration);
  animation-timing-function: var(--cosmos-out-easing);
  animation-fill-mode: forwards;
}
.cosmos-stage-layer[data-phase='in'] {
  animation-name: var(--cosmos-in-keyframes);
  animation-duration: var(--cosmos-in-duration);
  animation-timing-function: var(--cosmos-in-easing);
  animation-fill-mode: forwards;
}
```

- [ ] **Step 2: Create `display/src/lib/scene/TransitionStage.svelte`**

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { SceneState } from '$lib/types';
  import type { TransitionDescriptor, StageState } from '$lib/transitions/types';
  import { TransitionController } from '$lib/transitions/controller';
  import SceneCanvas from './SceneCanvas.svelte';

  export let scene: SceneState | null = null;
  export let transition: TransitionDescriptor | null = null;

  const controller = new TransitionController();
  let stageState: StageState = controller.current();
  let unsubscribe = controller.subscribe((s) => (stageState = s));

  let lastReceivedSceneId: string | null = null;
  $: if (scene && scene.id !== lastReceivedSceneId) {
    controller.receive(scene, transition);
    lastReceivedSceneId = scene.id;
  }

  onDestroy(() => unsubscribe());

  function styleFor(role: 'outgoing' | 'incoming'): string {
    if (!stageState.transition) return '';
    const phase = role === 'outgoing' ? stageState.transition.out : stageState.transition.in;
    return [
      `--cosmos-${role === 'outgoing' ? 'out' : 'in'}-keyframes: ${phase.keyframes};`,
      `--cosmos-${role === 'outgoing' ? 'out' : 'in'}-duration: ${phase.duration_ms}ms;`,
      `--cosmos-${role === 'outgoing' ? 'out' : 'in'}-easing: ${phase.easing};`,
    ].join(' ');
  }

  $: outgoing = stageState.outgoingScene;
  $: incoming = stageState.incomingScene;
  $: outPhase = stageState.phase === 'out' ? 'out' : null;
  $: inPhase = stageState.phase === 'in' ? 'in' : null;
</script>

{#if outgoing && stageState.phase !== 'idle'}
  <div class="cosmos-stage-layer" data-phase={outPhase} style={styleFor('outgoing')}>
    <SceneCanvas scene={outgoing} />
  </div>
{/if}
{#if incoming}
  <div
    class="cosmos-stage-layer"
    data-phase={stageState.phase === 'idle' ? null : inPhase}
    style={stageState.phase === 'idle' ? '' : styleFor('incoming')}
  >
    <SceneCanvas scene={incoming} />
  </div>
{/if}
```

- [ ] **Step 3: Update `display/src/routes/+layout.svelte`** to import keyframes:

```svelte
<script lang="ts">
  import '$lib/fonts.css';
  import '$lib/transitions/keyframes.css';
</script>

<slot />
```

- [ ] **Step 4: Update `display/src/routes/+page.svelte`** — receive transition from the WS message and pass it through TransitionStage:

In the script:

```ts
import TransitionStage from '$lib/scene/TransitionStage.svelte';
import type { TransitionDescriptor } from '$lib/transitions/types';

let pendingTransition: TransitionDescriptor | null = null;

function handleMessage(msg: ServerMessage) {
  if (msg.type === 'welcome') {
    greeting = msg.message;
    error = null;
  } else if (msg.type === 'scene') {
    pendingTransition = msg.transition ?? null;
    scene = msg.state;
    error = null;
  } else {
    error = msg.error;
  }
}
```

Replace the `{:else if scene}` branch:

```svelte
  {:else if scene}
    <TransitionStage {scene} transition={pendingTransition} />
```

(Remove the now-unused `import SceneCanvas from '$lib/scene/SceneCanvas.svelte';` line — TransitionStage owns rendering.)

- [ ] **Step 5: Build**

```bash
npm --workspace display run build
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add display/src/lib/transitions/keyframes.css display/src/lib/scene/TransitionStage.svelte display/src/routes/+layout.svelte display/src/routes/+page.svelte
git commit -m "feat(display): add TransitionStage with motion-transition keyframes"
```

---

## Task 8: Gradient-morph background interpolation

When the active transition has `bridge.background_morph === true`, interpolate the gradient color stops between the outgoing and incoming scene during the bridge phase. v1 implementation: render the incoming background normally, but during the Out phase keep the outgoing background visible underneath; during the In phase the new background fades in over the bridge. (CSS handles it because each layer has its own `<Background>` instance.)

For *true* color interpolation between gradient palettes (rather than two stacked gradients fading), introduce CSS custom properties `--cosmos-bg-color-N` per layer and morph them. Defer the perfect mesh-color-tween to v2; for v1, the layered fade with `gradient-morph` looking smooth is acceptable.

This task is a small enhancement: when the transition is `gradient-morph`, the bridge phase stays alive a bit longer (matching `out.duration_ms`) so the layered fade overlap reads as a morph rather than a hard cut.

**Files:**
- Modify: `display/src/lib/transitions/controller.ts`

- [ ] **Step 1: In `controller.ts`, change `advanceToBridge` to honor `bridge.background_morph`**

```ts
  private advanceToBridge(): void {
    if (!this.state.transition) return;
    this.set({ ...this.state, phase: 'bridge' });
    const bridgeMs = this.state.transition.bridge.background_morph
      ? Math.round(this.state.transition.in.duration_ms * 0.5)
      : 16;
    this.timer = setTimeout(() => this.advanceToIn(), bridgeMs);
  }
```

This keeps both backgrounds visible for half the In duration during gradient-morph, so the cross-fade reads as a color morph.

- [ ] **Step 2: Build and commit**

```bash
npm --workspace display run build
git add display/src/lib/transitions/controller.ts
git commit -m "feat(display): extend bridge phase for gradient-morph transitions"
```

---

## Task 9: End-to-end smoke verification

A scripted-then-visual check.

- [ ] **Step 1: Clean build**

```bash
rm -rf display/build server/dist data
npm run build
```

- [ ] **Step 2: Start server**

```bash
DB_PATH="$(pwd)/data/cosmos.db" npm --workspace server start
```

- [ ] **Step 3: Register display + create two scenes with different gradients + activate them in turn**

```bash
# Register display
curl -s -X POST http://localhost:8099/api/displays/register -H 'content-type: application/json' -d '{"name":"Living Room"}'

# Scene A — pink/purple gradient with default transition cross-fade
SA=$(curl -s -X POST http://localhost:8099/api/scenes -H 'content-type: application/json' -d '{
  "name":"Sunrise","defaultTransitionId":"builtin-cross-fade",
  "layout":{"cols":12,"rows":8,"items":[]},
  "background":{"type":"gradient","colors":["#ff7e5f","#feb47b","#ffd3a5"],"speed":"slow","style":"mesh"},
  "typography":{"font_family":"Inter","font_scale":1.0},
  "widgets":[{"kind":"clock","position":{"col":1,"row":1,"w":12,"h":4},"config":{"format":"24h"}}]
}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "scene A: $SA"

# Scene B — blue/teal gradient with default transition gradient-morph
SB=$(curl -s -X POST http://localhost:8099/api/scenes -H 'content-type: application/json' -d '{
  "name":"Twilight","defaultTransitionId":"builtin-gradient-morph",
  "layout":{"cols":12,"rows":8,"items":[]},
  "background":{"type":"gradient","colors":["#0f2027","#203a43","#2c5364"],"speed":"slow","style":"mesh"},
  "typography":{"font_family":"Fraunces","font_scale":1.5},
  "widgets":[{"kind":"clock","position":{"col":1,"row":1,"w":12,"h":4},"config":{"format":"24h"}}]
}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "scene B: $SB"

# Activate scene A first
curl -s -X POST "http://localhost:8099/api/displays/Living%20Room/scene/activate" -H 'content-type: application/json' -d "{\"sceneId\":\"$SA\"}"
echo ""
```

- [ ] **Step 4: Open the browser at http://localhost:8099/**

You should see scene A render with the pink/orange gradient and clock. There is no transition because this is the display's first scene this session.

- [ ] **Step 5: Activate scene B with the default (gradient-morph) transition**

```bash
curl -s -X POST "http://localhost:8099/api/displays/Living%20Room/scene/activate" -H 'content-type: application/json' -d "{\"sceneId\":\"$SB\"}"
```

The browser should run a 600ms gradient-morph transition: scene A fades while scene B fades in beneath, ending on the blue/teal gradient with a serif clock.

- [ ] **Step 6: Use the explicit `transitionId` parameter to test other built-ins**

The per-scene-pair override DB path is exercised by the server tests in Task 4. End-to-end, the easier way to test specific transitions is via the `transitionId` parameter on activate-scene:

```bash
# Switch back to A (A's default is cross-fade; no transitionId needed)
curl -s -X POST "http://localhost:8099/api/displays/Living%20Room/scene/activate" -H 'content-type: application/json' -d "{\"sceneId\":\"$SA\"}"

# Switch to B with explicit slide-up
curl -s -X POST "http://localhost:8099/api/displays/Living%20Room/scene/activate" -H 'content-type: application/json' -d "{\"sceneId\":\"$SB\",\"transitionId\":\"builtin-slide-up\"}"
```

The browser should run a slide-up transition: scene A slides up + fades, scene B slides in from below.

- [ ] **Step 7: Check `dissolve`**

```bash
curl -s -X POST "http://localhost:8099/api/displays/Living%20Room/scene/activate" -H 'content-type: application/json' -d "{\"sceneId\":\"$SA\",\"transitionId\":\"builtin-dissolve\"}"
```

Should run a 500ms blur-fade.

- [ ] **Step 8: Check reduced-motion**

Toggle Windows reduced-motion (Settings → Accessibility → Visual effects → Animation effects off). Reload the page. Activate scenes again — every transition should collapse to a 100ms cross-fade.

- [ ] **Step 9: Run full test suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 10: Persistence check**

Stop the server. Restart with the same `DB_PATH`. Reload — `currentSceneId` persists, scene re-renders. Override + activate paths still work.

---

## Task 10: CLAUDE.md updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `server/CLAUDE.md`
- Modify: `display/CLAUDE.md`

- [ ] **Step 1: Append to `CLAUDE.md` "Architecture (current)" — add a paragraph before "WebSocket protocol"**

```markdown
- `transitions/` (server) — built-in transition descriptors + per-scene-pair overrides. Server resolves which transition applies on each scene activation; client runs the choreography.
```

In the WebSocket protocol section, change:

```markdown
- `{type: 'scene', state: SceneState, transition?: TransitionDescriptor}` — sent on hello (without transition) and whenever the active scene changes (with transition resolved by the server).
```

In REST highlights, add:

```markdown
- `POST /api/displays/:name/scene/activate {sceneId, transitionId?}` — set the active scene with optional explicit transition override.
- `GET /api/transitions` / `GET /api/transitions/:id` — list/get transitions.
```

In Roadmap, replace:

```markdown
- Plan 3: Transition engine (Out → Bridge → In choreography between scenes).
```

with:

```markdown
- Plan 3: ✅ Shipped — transition engine with 6 built-ins + per-scene defaults + explicit overrides.
```

- [ ] **Step 2: Append to `server/CLAUDE.md` Layout section**

```markdown
- `src/transitions/` — transition descriptor types + builtins.
- `src/store/transitions.ts` — read-only repo for built-in transitions + a small overrides repo for per-scene-pair custom transitions.
- `src/api/transitions.ts` — `GET /api/transitions(/:id)` exposed for the editor (Plan 5) and curl exploration.
```

In "Adding things":

```markdown
- A new built-in transition: append to migration `transitions` seed (new migration version). Add the corresponding `@keyframes` block to `display/src/lib/transitions/keyframes.css`.
```

- [ ] **Step 3: Append to `display/CLAUDE.md` Layout section**

```markdown
- `src/lib/transitions/controller.ts` — `TransitionController` state machine. Drives the Out → Bridge → In phases on incoming scene changes. Honors `prefers-reduced-motion`.
- `src/lib/transitions/keyframes.css` — `@keyframes` blocks named to match server descriptors (`cosmos-out-fade`, `cosmos-in-scale-fade`, etc.). Add a new pair when adding a new transition.
- `src/lib/scene/TransitionStage.svelte` — wraps `SceneCanvas`. Mounts both outgoing and incoming canvases during a transition; applies CSS classes that drive the keyframe animations.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md server/CLAUDE.md display/CLAUDE.md
git commit -m "docs: update CLAUDE.md guides for the transition engine"
```

---

## Done criteria

- `npm test` is green.
- Activating different scenes via the new endpoint runs the correct transition in the browser (cross-fade by default, gradient-morph with overlapping bridge, slide-up/down, dissolve).
- Same-scene re-activation does not animate (no transition).
- Hello-time scene push has no transition.
- `prefers-reduced-motion` collapses every transition to 100ms.
- `currentSceneId` persists across server restarts.

The next plan (Plan 4: HA + MQTT) replaces the mock data pipeline in `assembler.ts` with a real Home Assistant client and adds MQTT discovery + the message-overlay primitive.
