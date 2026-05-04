# Cosmos HA + MQTT Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cosmos talk to Home Assistant. Replace `mockData.ts` with a real HA websocket client that subscribes to entity state changes; let HA see Cosmos as a device via MQTT discovery; let HA automations fire actions on Cosmos via MQTT command topics — including the **message overlay** primitive (the toast/banner from the original spec, e.g. "Dinner's ready"). Both integrations are optional: if `HA_URL`/`MQTT_URL` env vars are unset, Cosmos still runs and falls back to mock entity data with no overlay capability.

**Architecture:** Two new optional subsystems, each with a small interface that lets tests inject fakes:

- **HA client** — connects to `HA_URL`/`ws` with `HA_TOKEN`, subscribes to `state_changed` events on startup, maintains an in-memory `entityCache: Map<entity_id, EntityState>`. The assembler reads from the cache. When an entity used by an active scene's widget changes, the WS hub re-pushes that scene to the affected displays.
- **MQTT client** — connects to `MQTT_URL`. On startup, publishes Home Assistant MQTT discovery topics so HA auto-creates a "Cosmos" device with per-display entities (`sensor.cosmos_<display>_current_scene`, `binary_sensor.cosmos_<display>_online`). Subscribes to command topics `cosmos/<display>/message/set`, `cosmos/<display>/scene/set`, `cosmos/<display>/message/dismiss` — when those fire, the server pushes overlay/scene messages to the relevant display(s). The Mosquitto add-on is the typical broker.

Display gets a new `overlay` WS message type and a `MessageOverlay` Svelte component layered above `TransitionStage`.

**Tech Stack:** Adds `home-assistant-js-websocket` (the official HA WS client) and `mqtt` (the standard MQTT client) on the server side. Plus `aedes` as a dev dependency for an in-process MQTT broker used in tests.

---

## Common Conventions

- Branch off `main`: `git checkout main && git checkout -b cosmos-ha-and-mqtt`.
- TDD: failing test first, observe failure, implement, observe pass, commit.
- Both HA and MQTT integrations are **optional**: if env vars are absent, they don't connect and Cosmos still works (falling back to `mockData.ts` for entity data; overlay feature unavailable). Connection failures degrade gracefully and log the reason — they never crash the server.
- Tests inject fake clients at the dependency boundary. No test connects to a real HA instance or a real MQTT broker (the in-process `aedes` broker is only used in one MQTT integration smoke test).

---

## File Structure

New files:

```
server/src/
  ha/
    types.ts                 # HaEntityState type (already lives in scenes/types.ts as EntityState — re-export)
    client.ts                # HaClient interface + makeHaClient (real impl using home-assistant-js-websocket)
    cache.ts                 # entityCache + helpers (subscribe events update it)
    fakeClient.ts            # in-memory fake for tests
  mqtt/
    types.ts                 # MqttCommand union (showMessage, showScene, dismiss)
    client.ts                # MqttClient interface + makeMqttClient (real impl using mqtt)
    discovery.ts             # publishDiscovery(displays) — emits HA discovery topics
    commands.ts              # parseCommandTopic + handleCommand (pure, testable)
    fakeClient.ts            # in-memory fake for tests
  overlay/
    types.ts                 # OverlayMessage type
display/src/
  lib/
    overlay/
      MessageOverlay.svelte  # the toast/banner component
```

Modified files:

```
server/src/
  config.ts                  # haUrl, haToken, mqttUrl env vars
  scenes/types.ts            # nothing structural; EntityState already exists
  scenes/assembler.ts        # async; takes EntityResolver instead of importing mockData
  scenes/mockData.ts         # exposes mockEntity as the fallback resolver
  store/scenes.ts            # add getByName for MQTT show_scene
  api/ws.ts                  # async buildPayload; pushOverlayTo / dismissOverlayFor methods on CosmosWss
  api/http.ts                # nothing structural
  index.ts                   # wire HA client + MQTT client; route command callbacks; subscribe HA events to push affected scenes
display/src/
  lib/
    types.ts                 # OverlayMessage type (mirrors server)
    ws.ts                    # extend ServerMessage union with 'overlay' + 'overlay_dismiss'
  routes/+page.svelte        # render MessageOverlay above TransitionStage
CLAUDE.md                    # Plan 4 updates
server/CLAUDE.md             # ha/, mqtt/, overlay/ modules
display/CLAUDE.md            # overlay component
```

---

## Task 0: Make assembler async + introduce EntityResolver seam

This is the carry-over from Plan 3's final review (assembler will need to become async for HA reads). Do it as its own clean change before HA enters the picture, so each subsequent step is small.

**Files:**
- Modify: `server/src/scenes/assembler.ts`
- Modify: `server/src/scenes/mockData.ts` (no actual change to fixture; just verify export names)
- Modify: `server/src/api/ws.ts`
- Modify: `server/test/assembler.test.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git checkout -b cosmos-ha-and-mqtt
```

- [ ] **Step 2: Update `server/src/scenes/assembler.ts` to use an injected `EntityResolver` and async**

Replace the file with:

```ts
import type { Scene, Widget } from '../store/scenes.js';
import type { SceneState, WidgetState, WidgetData, ScenePushPayload } from './types.js';
import type { TransitionDescriptor } from '../transitions/types.js';
import type { TransitionsRepo, OverridesRepo } from '../store/transitions.js';
import type { EntityState } from './types.js';
import { MOCK_WEATHER, mockEntity } from './mockData.js';

export type EntityResolver = (entityId: string) => EntityState | Promise<EntityState>;

export const mockEntityResolver: EntityResolver = (entityId) => mockEntity(entityId);

async function dataFor(widget: Widget, resolver: EntityResolver): Promise<WidgetData> {
  switch (widget.kind) {
    case 'clock':
      return null;
    case 'weather':
      return MOCK_WEATHER;
    case 'entity_tile': {
      const entityId = String((widget.config as { entity_id?: string }).entity_id ?? '');
      return await resolver(entityId);
    }
  }
}

export async function buildSceneState(
  scene: Scene,
  safeArea: { top: number; right: number; bottom: number; left: number },
  resolver: EntityResolver = mockEntityResolver
): Promise<SceneState> {
  const widgets: WidgetState[] = [];
  for (const w of scene.widgets) {
    widgets.push({ ...w, data: await dataFor(w, resolver) });
  }
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
  resolver?: EntityResolver;
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

export async function assemblePush(args: AssemblePushArgs): Promise<ScenePushPayload> {
  const state = await buildSceneState(args.scene, args.safeArea, args.resolver);
  const transition = resolveTransition(args);
  return transition ? { type: 'scene', state, transition } : { type: 'scene', state };
}
```

- [ ] **Step 3: Update `server/src/api/ws.ts`** — make `buildPayload` async + thread an optional resolver:

Replace the relevant pieces (the `WsDeps` type gains `resolveEntity?` and `buildPayload` becomes async):

```ts
export type WsDeps = {
  displays: DisplaysRepo;
  scenes: ScenesRepo;
  settings: SettingsRepo;
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
  resolveEntity?: import('../scenes/assembler.js').EntityResolver;
};
```

Replace `buildPayload` and the call site with this version (everything else in the file stays):

```ts
  async function buildPayload(displayId: string, explicitTransitionId?: string | null): Promise<string | null> {
    const sceneId = activeSceneId(displayId, deps);
    if (!sceneId) return null;
    const scene = deps.scenes.get(sceneId);
    if (!scene) return null;
    const previousSceneId = lastSceneByDisplay.get(displayId) ?? null;
    const safeArea = readSafeArea(deps.settings);
    const payload = await assemblePush({
      scene,
      safeArea,
      previousSceneId,
      transitions: deps.transitions,
      overrides: deps.overrides,
      explicitTransitionId,
      resolver: deps.resolveEntity,
    });
    lastSceneByDisplay.set(displayId, scene.id);
    return JSON.stringify(payload);
  }
```

The hello-time push and `pushSceneTo` callers must `await` the payload now. Update them:

In the `socket.on('message', ...)` handler, replace:

```ts
      const sceneMsg = sceneMessageFor(display.id, deps);
      if (sceneMsg) socket.send(sceneMsg);
```

with:

```ts
      lastSceneByDisplay.delete(display.id);
      const payload = await buildPayload(display.id);
      if (payload) socket.send(payload);
```

(Note: the `socket.on('message', (raw) => { ... })` callback is already typed to allow async — wrap the body in an async IIFE if TypeScript complains. Concrete pattern: change the listener to `socket.on('message', (raw) => { void (async () => { ... })(); });` or just mark the handler `async`.)

In `wss.pushSceneTo`, change to:

```ts
  wss.pushSceneTo = async (displayId, opts) => {
    const set = sockets.get(displayId);
    if (!set || set.size === 0) return;
    const payload = await buildPayload(displayId, opts?.explicitTransitionId);
    if (!payload) return;
    for (const s of set) {
      if (s.readyState === s.OPEN) s.send(payload);
    }
  };
```

In `wss.pushSettingsChanged`, change to:

```ts
  wss.pushSettingsChanged = async () => {
    for (const displayId of sockets.keys()) await wss.pushSceneTo(displayId);
  };
```

Update the `CosmosWss` type to make `pushSceneTo` and `pushSettingsChanged` return `Promise<void>`:

```ts
export type CosmosWss = WebSocketServer & {
  pushSceneTo(displayId: string, opts?: { explicitTransitionId?: string | null }): Promise<void>;
  pushSettingsChanged(): Promise<void>;
};
```

The `sceneMessageFor` helper from earlier is no longer needed — `buildPayload` does all of it. Remove it if present.

- [ ] **Step 4: Update `server/test/assembler.test.ts`** to await calls:

Wherever `buildSceneState(...)` or `assemblePush(...)` is called inside an `it(...)`, the callback must be `async` and the call must be `await`-ed. Each test changes from:

```ts
  it('passes scene metadata through unchanged', () => {
    const state = buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    expect(state.id).toBe('scene-1');
  });
```

to:

```ts
  it('passes scene metadata through unchanged', async () => {
    const state = await buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    expect(state.id).toBe('scene-1');
  });
```

Apply the same pattern to every existing test in this file. The assertions stay identical.

- [ ] **Step 5: Run the full server test suite**

```bash
npm --workspace server test
```

Expected: all 68 tests pass. If anything fails because of a missed `await`, fix it.

- [ ] **Step 6: Build**

```bash
npm --workspace server run build
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add server/src/scenes/assembler.ts server/src/api/ws.ts server/test/assembler.test.ts
git commit -m "refactor(server): make assembler async with EntityResolver seam"
```

---

## Task 1: HA client interface + entity cache

Define the `HaClient` interface and an in-memory entity cache. The cache is the source of truth for entity state on the server. The real client implementation comes in Task 2.

**Files:**
- Create: `server/src/ha/types.ts`
- Create: `server/src/ha/cache.ts`
- Create: `server/src/ha/fakeClient.ts`
- Create: `server/test/ha-cache.test.ts`

- [ ] **Step 1: Create `server/src/ha/types.ts`**

```ts
import type { EntityState } from '../scenes/types.js';

export type { EntityState };

export type StateChangedHandler = (entity: EntityState) => void;

export type HaClient = {
  /** Resolve once the initial state snapshot is loaded. */
  ready(): Promise<void>;
  /** Look up an entity from the local cache; returns null if unknown. */
  getEntity(entityId: string): EntityState | null;
  /** Subscribe to incremental state changes. Returns an unsubscribe function. */
  onStateChanged(handler: StateChangedHandler): () => void;
  /** Disconnect cleanly. */
  close(): Promise<void>;
};
```

- [ ] **Step 2: Create `server/src/ha/cache.ts`**

```ts
import type { EntityState, StateChangedHandler } from './types.js';

export type EntityCache = {
  set(entity: EntityState): void;
  setMany(entities: EntityState[]): void;
  get(entityId: string): EntityState | null;
  emitChange(entity: EntityState): void;
  onChange(handler: StateChangedHandler): () => void;
};

export function createEntityCache(): EntityCache {
  const map = new Map<string, EntityState>();
  const handlers = new Set<StateChangedHandler>();
  return {
    set(entity) {
      map.set(entity.entity_id, entity);
    },
    setMany(entities) {
      for (const e of entities) map.set(e.entity_id, e);
    },
    get(entityId) {
      return map.get(entityId) ?? null;
    },
    emitChange(entity) {
      map.set(entity.entity_id, entity);
      for (const h of handlers) h(entity);
    },
    onChange(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
```

- [ ] **Step 3: Create `server/src/ha/fakeClient.ts`**

```ts
import type { HaClient, EntityState, StateChangedHandler } from './types.js';
import { createEntityCache } from './cache.js';

/** A fake HA client backed by the entity cache. Tests seed it with `set()` and emit changes with `emit()`. */
export type FakeHaClient = HaClient & {
  set(entity: EntityState): void;
  setMany(entities: EntityState[]): void;
  emit(entity: EntityState): void;
};

export function createFakeHaClient(initial: EntityState[] = []): FakeHaClient {
  const cache = createEntityCache();
  cache.setMany(initial);
  return {
    ready: async () => {},
    getEntity: (id) => cache.get(id),
    onStateChanged: (h) => cache.onChange(h),
    close: async () => {},
    set: (e) => cache.set(e),
    setMany: (es) => cache.setMany(es),
    emit: (e) => cache.emitChange(e),
  };
}
```

- [ ] **Step 4: Write the failing test `server/test/ha-cache.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createEntityCache } from '../src/ha/cache.js';
import { createFakeHaClient } from '../src/ha/fakeClient.js';

describe('entity cache', () => {
  it('set + get round-trips', () => {
    const c = createEntityCache();
    c.set({ entity_id: 'light.kitchen', state: 'on', attributes: {} });
    expect(c.get('light.kitchen')?.state).toBe('on');
    expect(c.get('light.unknown')).toBeNull();
  });

  it('emitChange notifies subscribers and updates the cached value', () => {
    const c = createEntityCache();
    c.set({ entity_id: 'light.kitchen', state: 'off', attributes: {} });
    let last: string | null = null;
    const off = c.onChange((e) => (last = e.state));
    c.emitChange({ entity_id: 'light.kitchen', state: 'on', attributes: { brightness: 200 } });
    expect(last).toBe('on');
    expect(c.get('light.kitchen')?.attributes.brightness).toBe(200);
    off();
    c.emitChange({ entity_id: 'light.kitchen', state: 'off', attributes: {} });
    expect(last).toBe('on'); // unsubscribed handler did not fire
  });
});

describe('fake HA client', () => {
  it('seeded entities are queryable via getEntity', () => {
    const ha = createFakeHaClient([
      { entity_id: 'sensor.outside_temp', state: '14.5', attributes: { unit_of_measurement: '°C' } },
    ]);
    expect(ha.getEntity('sensor.outside_temp')?.state).toBe('14.5');
    expect(ha.getEntity('sensor.missing')).toBeNull();
  });

  it('emit triggers subscribers', () => {
    const ha = createFakeHaClient();
    let fired = 0;
    ha.onStateChanged(() => (fired += 1));
    ha.emit({ entity_id: 'light.x', state: 'on', attributes: {} });
    expect(fired).toBe(1);
  });
});
```

- [ ] **Step 5: Run the test, see it pass** (since the implementation is in place):

```bash
npm --workspace server test -- ha-cache
```

Expected: 4 tests pass.

- [ ] **Step 6: Run the full suite**

```bash
npm --workspace server test
```

Expected: 72 tests pass (was 68, +4 new).

- [ ] **Step 7: Commit**

```bash
git add server/src/ha/types.ts server/src/ha/cache.ts server/src/ha/fakeClient.ts server/test/ha-cache.test.ts
git commit -m "feat(server): add HA client interface, entity cache, and fake client"
```

---

## Task 2: Real HA client implementation

Use `home-assistant-js-websocket` to connect, authenticate, and subscribe to state changes.

**Files:**
- Modify: `server/package.json` (add `home-assistant-js-websocket`)
- Create: `server/src/ha/client.ts`

- [ ] **Step 1: Install the package**

```bash
npm --workspace server install home-assistant-js-websocket
```

- [ ] **Step 2: Create `server/src/ha/client.ts`**

The package needs a `WebSocket` global; since we run in Node and Node 20+ has native `WebSocket`, this works without a polyfill.

```ts
import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  type Connection,
} from 'home-assistant-js-websocket';
import type { HaClient, EntityState, StateChangedHandler } from './types.js';
import { createEntityCache } from './cache.js';

export type HaConfig = {
  url: string;       // e.g. http://homeassistant.local:8123
  token: string;     // long-lived access token
};

export async function makeHaClient(config: HaConfig): Promise<HaClient> {
  const cache = createEntityCache();
  const auth = createLongLivedTokenAuth(config.url, config.token);
  let connection: Connection | null = null;

  let readyResolve!: () => void;
  const readyPromise = new Promise<void>((r) => (readyResolve = r));
  let firstSnapshotReceived = false;

  connection = await createConnection({ auth });

  const unsubscribe = subscribeEntities(connection, (entities) => {
    const list: EntityState[] = Object.values(entities).map((e) => ({
      entity_id: e.entity_id,
      state: String(e.state),
      attributes: { ...e.attributes },
    }));
    cache.setMany(list);
    if (!firstSnapshotReceived) {
      firstSnapshotReceived = true;
      readyResolve();
    } else {
      // emit per-entity changes — subscribeEntities re-fires the whole map every time
      // but we only want subscribers to see what actually changed. Cheap approach:
      // emit every entity in the snapshot; downstream handlers can de-dup.
      for (const e of list) cache.emitChange(e);
    }
  });

  return {
    ready: () => readyPromise,
    getEntity: (id) => cache.get(id),
    onStateChanged: (h: StateChangedHandler) => cache.onChange(h),
    close: async () => {
      unsubscribe();
      connection?.close();
    },
  };
}
```

(Note: `subscribeEntities` fires whenever any entity changes. The per-snapshot emit is intentional: subscribers will get called once per change-event with every visible entity, but the WS hub uses this to recompute scene push for affected displays — it filters by what entities are actually used in active scenes' widgets.)

- [ ] **Step 3: Verify the build compiles**

```bash
npm --workspace server run build
```

Expected: exit 0.

- [ ] **Step 4: Commit**

The real client is not under test (it requires a live HA). The fake from Task 1 is the test seam.

```bash
git add server/package.json package-lock.json server/src/ha/client.ts
git commit -m "feat(server): add real HA client implementation"
```

---

## Task 3: Wire HA client into config + index.ts; reactive scene push on entity change

Add `HA_URL` and `HA_TOKEN` env vars. If both are set, connect to HA, subscribe to changes, and re-push affected scenes to displays. Otherwise fall back to mock data.

**Files:**
- Modify: `server/src/config.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Update `server/src/config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

export const config = {
  port: Number(process.env.PORT ?? 8099),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? resolve(repoRoot, 'data', 'cosmos.db'),
  staticDir: process.env.STATIC_DIR ?? resolve(repoRoot, 'display', 'build'),
  haUrl: process.env.HA_URL ?? null,
  haToken: process.env.HA_TOKEN ?? null,
  mqttUrl: process.env.MQTT_URL ?? null,
};
```

- [ ] **Step 2: Replace `server/src/index.ts`**

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
import { makeHaClient } from './ha/client.js';
import type { HaClient } from './ha/types.js';
import { mockEntityResolver } from './scenes/assembler.js';

function widgetEntityIds(scenes: ReturnType<typeof createScenesRepo>): Set<string> {
  const ids = new Set<string>();
  for (const s of scenes.list()) {
    for (const w of s.widgets) {
      const id = (w.config as { entity_id?: string }).entity_id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

async function main() {
  const db = openDatabase(config.dbPath);
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);

  let haClient: HaClient | null = null;
  if (config.haUrl && config.haToken) {
    try {
      console.log(`connecting to Home Assistant at ${config.haUrl}`);
      haClient = await makeHaClient({ url: config.haUrl, token: config.haToken });
      await haClient.ready();
      console.log('Home Assistant connected; entity cache populated');
    } catch (err) {
      console.error('Home Assistant connection failed; falling back to mock entity data', err);
      haClient = null;
    }
  } else {
    console.log('HA_URL/HA_TOKEN not set; using mock entity data');
  }

  const resolveEntity = haClient
    ? (entityId: string) => haClient!.getEntity(entityId) ?? mockEntityResolver(entityId)
    : mockEntityResolver;

  let wssRef: ReturnType<typeof attachWsHub> | null = null;
  const onSceneChanged = (displayId: string, opts?: { explicitTransitionId?: string | null }) =>
    void wssRef?.pushSceneTo(displayId, opts);

  const app = await buildHttpApp({
    displays,
    settings,
    scenes,
    transitions,
    overrides,
    onSceneChanged,
    onSettingsChanged: () => void wssRef?.pushSettingsChanged(),
  });
  await registerStatic(app, config.staticDir);
  const wss = attachWsHub(app.server, { displays, scenes, settings, transitions, overrides, resolveEntity });
  wssRef = wss;

  // When HA emits a state change for an entity used by an active scene, re-push that scene.
  if (haClient) {
    haClient.onStateChanged((entity) => {
      const usedIds = widgetEntityIds(scenes);
      if (!usedIds.has(entity.entity_id)) return;
      for (const d of displays.list()) {
        const activeId = d.currentSceneId ?? d.defaultSceneId;
        if (!activeId) continue;
        const scene = scenes.get(activeId);
        if (!scene) continue;
        const usesIt = scene.widgets.some((w) => (w.config as { entity_id?: string }).entity_id === entity.entity_id);
        if (usesIt) void wssRef?.pushSceneTo(d.id);
      }
    });
  }

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
      await haClient?.close();
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

- [ ] **Step 3: Build**

```bash
npm --workspace server run build
```

Expected: exit 0.

- [ ] **Step 4: Run full suite — make sure nothing else broke**

```bash
npm --workspace server test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/src/index.ts
git commit -m "feat(server): wire HA client + reactive scene push on entity change"
```

---

## Task 4: Add `scenes.getByName` for MQTT show_scene

MQTT `show_scene` carries `{scene_name}`. The repo needs a name lookup.

**Files:**
- Modify: `server/src/store/scenes.ts` (add `getByName` to `ScenesRepo` + implementation)
- Modify: `server/test/scenes.test.ts` (add a test)

- [ ] **Step 1: Add a test inside `describe('scenes repo', ...)`**

```ts
  it('getByName returns the scene or null', () => {
    const ctx = setup();
    const created = ctx.scenes.create({ ...sample, name: 'NamedOne' });
    expect(ctx.scenes.getByName('NamedOne')?.id).toBe(created.id);
    expect(ctx.scenes.getByName('NotExists')).toBeNull();
  });
```

- [ ] **Step 2: Run the test, see fail**

```bash
npm --workspace server test -- scenes
```

- [ ] **Step 3: Add `getByName` to `ScenesRepo`**

In `server/src/store/scenes.ts`, add to the `ScenesRepo` type:

```ts
  getByName(name: string): Scene | null;
```

In `createScenesRepo`, add a prepared statement:

```ts
  const selectSceneByName = db.prepare<[string], SceneRow>(
    'SELECT id, name, layout_json, background_json, typography_json, default_transition_id FROM scenes WHERE name = ?'
  );
```

And the method in the returned object:

```ts
    getByName(name) {
      const row = selectSceneByName.get(name);
      if (!row) return null;
      return rowToScene(row, loadWidgets(row.id));
    },
```

- [ ] **Step 4: Run scenes tests**

```bash
npm --workspace server test -- scenes
```

Expected: 10 scenes-repo tests pass (was 9, +1 new).

- [ ] **Step 5: Commit**

```bash
git add server/src/store/scenes.ts server/test/scenes.test.ts
git commit -m "feat(server): add ScenesRepo.getByName for MQTT name lookups"
```

---

## Task 5: Overlay primitive (server-side WS push) + display types

Define the overlay message shape on both sides; add `pushOverlayTo(displayName, overlay)` and `dismissOverlayFor(displayName)` to the WS hub.

**Files:**
- Create: `server/src/overlay/types.ts`
- Modify: `server/src/api/ws.ts`
- Modify: `display/src/lib/types.ts` (add OverlayMessage type)
- Modify: `display/src/lib/ws.ts` (extend ServerMessage union)
- Create: `server/test/overlay-push.test.ts`

- [ ] **Step 1: Create `server/src/overlay/types.ts`**

```ts
export type OverlayMessage = {
  title: string;
  body?: string;
  icon?: string;
  timeout_ms?: number;
};
```

- [ ] **Step 2: Update `server/src/api/ws.ts`**

Add to the imports:

```ts
import type { OverlayMessage } from '../overlay/types.js';
```

Add to the `CosmosWss` type:

```ts
export type CosmosWss = WebSocketServer & {
  pushSceneTo(displayId: string, opts?: { explicitTransitionId?: string | null }): Promise<void>;
  pushSettingsChanged(): Promise<void>;
  pushOverlayTo(displayId: string, overlay: OverlayMessage): void;
  pushOverlayToAll(overlay: OverlayMessage): void;
  dismissOverlayFor(displayId: string): void;
  dismissOverlayForAll(): void;
};
```

Add the implementations after the existing `wss.pushSettingsChanged = ...` block:

```ts
  function sendToDisplay(displayId: string, payload: object): void {
    const set = sockets.get(displayId);
    if (!set || set.size === 0) return;
    const msg = JSON.stringify(payload);
    for (const s of set) {
      if (s.readyState === s.OPEN) s.send(msg);
    }
  }

  wss.pushOverlayTo = (displayId, overlay) => {
    sendToDisplay(displayId, { type: 'overlay', overlay });
  };
  wss.pushOverlayToAll = (overlay) => {
    for (const id of sockets.keys()) sendToDisplay(id, { type: 'overlay', overlay });
  };
  wss.dismissOverlayFor = (displayId) => {
    sendToDisplay(displayId, { type: 'overlay_dismiss' });
  };
  wss.dismissOverlayForAll = () => {
    for (const id of sockets.keys()) sendToDisplay(id, { type: 'overlay_dismiss' });
  };
```

- [ ] **Step 3: Update `display/src/lib/types.ts`** to add OverlayMessage:

Add at the bottom:

```ts
export type OverlayMessage = {
  title: string;
  body?: string;
  icon?: string;
  timeout_ms?: number;
};
```

- [ ] **Step 4: Update `display/src/lib/ws.ts`** ServerMessage union:

```ts
import type { SceneState, OverlayMessage } from './types';
import type { TransitionDescriptor } from './transitions/types';

export type WelcomeMessage = { type: 'welcome'; displayId: string; message: string };
export type SceneMessage = { type: 'scene'; state: SceneState; transition?: TransitionDescriptor };
export type OverlayPushMessage = { type: 'overlay'; overlay: OverlayMessage };
export type OverlayDismissMessage = { type: 'overlay_dismiss' };
export type ErrorMessage = { type: 'error'; error: string };
export type ServerMessage =
  | WelcomeMessage
  | SceneMessage
  | OverlayPushMessage
  | OverlayDismissMessage
  | ErrorMessage;
```

(`connect` and the rest are unchanged.)

- [ ] **Step 5: Write `server/test/overlay-push.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';
import { attachWsHub } from '../src/api/ws.js';

async function startServer() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  const app = await buildHttpApp({ displays, settings, scenes, transitions, overrides });
  const wss = attachWsHub(app.server, { displays, scenes, settings, transitions, overrides });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no address');
  return { app, wss, port: addr.port, displays };
}

function nextMsg(ws: WebSocket): Promise<{ type: string } & Record<string, unknown>> {
  return new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()))));
}

describe('overlay push', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>;
  beforeEach(async () => {
    ctx = await startServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('pushOverlayTo delivers an overlay message to a connected display', async () => {
    const display = ctx.displays.registerByName('Living Room');
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Living Room' }));
    await nextMsg(ws); // consume welcome (no scene assigned)

    const recv = nextMsg(ws);
    ctx.wss.pushOverlayTo(display.id, { title: "Dinner's ready", timeout_ms: 5000 });
    const msg = (await recv) as { type: string; overlay: { title: string; timeout_ms: number } };
    expect(msg.type).toBe('overlay');
    expect(msg.overlay.title).toBe("Dinner's ready");
    expect(msg.overlay.timeout_ms).toBe(5000);

    ws.close();
  });

  it('dismissOverlayFor delivers an overlay_dismiss message', async () => {
    const display = ctx.displays.registerByName('Kitchen');
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Kitchen' }));
    await nextMsg(ws);

    const recv = nextMsg(ws);
    ctx.wss.dismissOverlayFor(display.id);
    const msg = await recv;
    expect(msg.type).toBe('overlay_dismiss');

    ws.close();
  });
});
```

- [ ] **Step 6: Run tests**

```bash
npm --workspace server test
```

Expected: all green; +2 new tests.

- [ ] **Step 7: Build display**

```bash
npm --workspace display run build
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add server/src/overlay/types.ts server/src/api/ws.ts display/src/lib/types.ts display/src/lib/ws.ts server/test/overlay-push.test.ts
git commit -m "feat: add overlay primitive — server push + display message types"
```

---

## Task 6: Display — MessageOverlay component

A toast/banner layered above `TransitionStage`. Auto-dismiss when `timeout_ms` is set; tappable to dismiss.

**Files:**
- Create: `display/src/lib/overlay/MessageOverlay.svelte`
- Modify: `display/src/routes/+page.svelte`

- [ ] **Step 1: Create `display/src/lib/overlay/MessageOverlay.svelte`**

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { OverlayMessage } from '$lib/types';

  export let overlay: OverlayMessage | null = null;
  export let onDismiss: () => void = () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;

  $: if (overlay && overlay.timeout_ms && overlay.timeout_ms > 0) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onDismiss(), overlay.timeout_ms);
  }

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });

  function dismiss() {
    if (timer) clearTimeout(timer);
    onDismiss();
  }
</script>

{#if overlay}
  <button class="overlay-toast" on:click={dismiss} aria-live="polite">
    {#if overlay.icon}
      <span class="icon" aria-hidden="true">{overlay.icon}</span>
    {/if}
    <span class="text">
      <span class="title">{overlay.title}</span>
      {#if overlay.body}
        <span class="body">{overlay.body}</span>
      {/if}
    </span>
  </button>
{/if}

<style>
  .overlay-toast {
    position: fixed;
    z-index: 100;
    left: 50%;
    top: 2rem;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    border: none;
    border-radius: 1rem;
    background: rgba(20, 20, 28, 0.92);
    color: #f5f5f5;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    font-family: inherit;
    cursor: pointer;
    animation: cosmos-overlay-in 350ms ease-out;
  }
  .icon {
    font-size: 1.5rem;
  }
  .text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    text-align: left;
  }
  .title {
    font-size: 1.05rem;
    font-weight: 500;
  }
  .body {
    font-size: 0.9rem;
    opacity: 0.75;
  }
  @keyframes cosmos-overlay-in {
    from { opacity: 0; transform: translate(-50%, -1rem); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .overlay-toast {
      animation: none;
    }
  }
</style>
```

- [ ] **Step 2: Update `display/src/routes/+page.svelte`** — track overlay state and route messages:

In the script, add overlay tracking:

```ts
import MessageOverlay from '$lib/overlay/MessageOverlay.svelte';
import type { OverlayMessage } from '$lib/types';

let overlay: OverlayMessage | null = null;
```

Update `handleMessage` to handle the new message types:

```ts
  function handleMessage(msg: ServerMessage) {
    if (msg.type === 'welcome') {
      greeting = msg.message;
      error = null;
    } else if (msg.type === 'scene') {
      pendingTransition = msg.transition ?? null;
      scene = msg.state;
      error = null;
    } else if (msg.type === 'overlay') {
      overlay = msg.overlay;
    } else if (msg.type === 'overlay_dismiss') {
      overlay = null;
    } else {
      error = msg.error;
    }
  }
```

In the markup, render the overlay above everything (still inside `<main>`, but it positions itself fixed):

After the existing `{:else if scene}` branch's content, add (still within the `{:else if scene}` block, before the closing `{/if}`):

```svelte
    <MessageOverlay {overlay} onDismiss={() => (overlay = null)} />
```

The overlay is only rendered when there's a scene to overlay onto. (If you want the overlay visible even pre-scene, move the `<MessageOverlay>` outside the if-else chain — but for v1, scene-context overlays are sufficient.)

- [ ] **Step 3: Build**

```bash
npm --workspace display run build
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add display/src/lib/overlay/MessageOverlay.svelte display/src/routes/+page.svelte
git commit -m "feat(display): add MessageOverlay component layered above scene"
```

---

## Task 7: MQTT client interface + fake + command parsing

Define the `MqttClient` interface and a pure command parser. The real client comes in Task 8.

**Files:**
- Create: `server/src/mqtt/types.ts`
- Create: `server/src/mqtt/commands.ts`
- Create: `server/src/mqtt/fakeClient.ts`
- Create: `server/test/mqtt-commands.test.ts`

- [ ] **Step 1: Create `server/src/mqtt/types.ts`**

```ts
import type { OverlayMessage } from '../overlay/types.js';

/** Targeted display from a topic — `'all'` means broadcast. */
export type CommandTarget = string | 'all';

export type ShowMessageCommand = { kind: 'show_message'; target: CommandTarget; message: OverlayMessage };
export type DismissMessageCommand = { kind: 'dismiss_message'; target: CommandTarget };
export type ShowSceneCommand = { kind: 'show_scene'; target: CommandTarget; sceneName: string };

export type ParsedCommand = ShowMessageCommand | DismissMessageCommand | ShowSceneCommand;

export type MqttClient = {
  /** Publish a JSON payload (will be JSON.stringified) to a topic, with optional retain. */
  publish(topic: string, payload: object | string, opts?: { retain?: boolean }): void;
  /** Subscribe to a topic; the handler receives raw payload bytes as a string. */
  subscribe(topic: string, handler: (topic: string, payload: string) => void): void;
  close(): Promise<void>;
};
```

- [ ] **Step 2: Create `server/src/mqtt/commands.ts`**

```ts
import type { ParsedCommand } from './types.js';

const TOPIC_RE = /^cosmos\/([^/]+)\/(message\/set|message\/dismiss|scene\/set)$/;

export function parseCommandTopic(topic: string, payload: string): ParsedCommand | null {
  const m = TOPIC_RE.exec(topic);
  if (!m) return null;
  const [, target, action] = m;
  switch (action) {
    case 'message/set': {
      let body: unknown;
      try {
        body = JSON.parse(payload);
      } catch {
        return null;
      }
      if (typeof body !== 'object' || body === null) return null;
      const b = body as Record<string, unknown>;
      if (typeof b.title !== 'string' || b.title.trim() === '') return null;
      return {
        kind: 'show_message',
        target,
        message: {
          title: b.title,
          body: typeof b.body === 'string' ? b.body : undefined,
          icon: typeof b.icon === 'string' ? b.icon : undefined,
          timeout_ms: typeof b.timeout_ms === 'number' ? b.timeout_ms : undefined,
        },
      };
    }
    case 'message/dismiss':
      return { kind: 'dismiss_message', target };
    case 'scene/set': {
      let body: unknown;
      try {
        body = JSON.parse(payload);
      } catch {
        return null;
      }
      if (typeof body !== 'object' || body === null) return null;
      const b = body as Record<string, unknown>;
      if (typeof b.scene_name !== 'string' || b.scene_name.trim() === '') return null;
      return { kind: 'show_scene', target, sceneName: b.scene_name };
    }
  }
  return null;
}
```

- [ ] **Step 3: Create `server/src/mqtt/fakeClient.ts`**

```ts
import type { MqttClient } from './types.js';

export type FakeMqttClient = MqttClient & {
  /** All published messages, in order. */
  published: Array<{ topic: string; payload: string; retain: boolean }>;
  /** Manually invoke any subscribed handlers as if a broker delivered the message. */
  inject(topic: string, payload: string): void;
};

export function createFakeMqttClient(): FakeMqttClient {
  const subscriptions = new Map<string, ((topic: string, payload: string) => void)[]>();
  const published: FakeMqttClient['published'] = [];

  function topicMatches(filter: string, topic: string): boolean {
    if (filter === topic) return true;
    if (!filter.includes('+') && !filter.includes('#')) return false;
    const f = filter.split('/');
    const t = topic.split('/');
    for (let i = 0; i < f.length; i++) {
      const fp = f[i];
      if (fp === '#') return true;
      if (fp === '+') {
        if (t[i] === undefined) return false;
        continue;
      }
      if (fp !== t[i]) return false;
    }
    return f.length === t.length;
  }

  return {
    publish(topic, payload, opts) {
      const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
      published.push({ topic, payload: str, retain: opts?.retain ?? false });
    },
    subscribe(topic, handler) {
      const list = subscriptions.get(topic) ?? [];
      list.push(handler);
      subscriptions.set(topic, list);
    },
    close: async () => {},
    published,
    inject(topic, payload) {
      for (const [filter, handlers] of subscriptions) {
        if (!topicMatches(filter, topic)) continue;
        for (const h of handlers) h(topic, payload);
      }
    },
  };
}
```

- [ ] **Step 4: Write failing test `server/test/mqtt-commands.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseCommandTopic } from '../src/mqtt/commands.js';
import { createFakeMqttClient } from '../src/mqtt/fakeClient.js';

describe('parseCommandTopic', () => {
  it('parses message/set with title-only payload', () => {
    const cmd = parseCommandTopic('cosmos/Living%20Room/message/set', '{"title":"Hello"}');
    expect(cmd).toEqual({
      kind: 'show_message',
      target: 'Living%20Room',
      message: { title: 'Hello', body: undefined, icon: undefined, timeout_ms: undefined },
    });
  });

  it('parses message/set with full payload', () => {
    const cmd = parseCommandTopic('cosmos/Kitchen/message/set', '{"title":"X","body":"Y","icon":"🔔","timeout_ms":4000}');
    expect(cmd?.kind).toBe('show_message');
    if (cmd?.kind === 'show_message') {
      expect(cmd.message).toEqual({ title: 'X', body: 'Y', icon: '🔔', timeout_ms: 4000 });
    }
  });

  it('rejects message/set without title', () => {
    expect(parseCommandTopic('cosmos/Hall/message/set', '{}')).toBeNull();
    expect(parseCommandTopic('cosmos/Hall/message/set', '{"title":""}')).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseCommandTopic('cosmos/Hall/message/set', 'not json')).toBeNull();
  });

  it('parses message/dismiss with empty payload', () => {
    expect(parseCommandTopic('cosmos/Hall/message/dismiss', '')).toEqual({
      kind: 'dismiss_message',
      target: 'Hall',
    });
  });

  it('parses scene/set with scene_name', () => {
    expect(parseCommandTopic('cosmos/Hall/scene/set', '{"scene_name":"Morning"}')).toEqual({
      kind: 'show_scene',
      target: 'Hall',
      sceneName: 'Morning',
    });
  });

  it('returns null for unrelated topics', () => {
    expect(parseCommandTopic('homeassistant/sensor/whatever', '{}')).toBeNull();
  });

  it('treats target=all as broadcast', () => {
    const cmd = parseCommandTopic('cosmos/all/message/set', '{"title":"Hi"}');
    expect(cmd?.target).toBe('all');
  });
});

describe('fake MQTT client', () => {
  it('inject delivers a payload to handlers whose topic matches via wildcards', () => {
    const m = createFakeMqttClient();
    let received: { topic: string; payload: string } | null = null;
    m.subscribe('cosmos/+/message/set', (t, p) => (received = { topic: t, payload: p }));
    m.inject('cosmos/Living/message/set', '{"title":"hi"}');
    expect(received).toEqual({ topic: 'cosmos/Living/message/set', payload: '{"title":"hi"}' });
  });

  it('publish records messages with retain flag', () => {
    const m = createFakeMqttClient();
    m.publish('homeassistant/sensor/x/config', { name: 'X' }, { retain: true });
    m.publish('cosmos/Living/scene', 'Morning');
    expect(m.published).toEqual([
      { topic: 'homeassistant/sensor/x/config', payload: '{"name":"X"}', retain: true },
      { topic: 'cosmos/Living/scene', payload: 'Morning', retain: false },
    ]);
  });
});
```

- [ ] **Step 5: Run test, see pass**

```bash
npm --workspace server test -- mqtt-commands
```

Expected: all 10 tests pass.

- [ ] **Step 6: Run full suite**

```bash
npm --workspace server test
```

- [ ] **Step 7: Commit**

```bash
git add server/src/mqtt/types.ts server/src/mqtt/commands.ts server/src/mqtt/fakeClient.ts server/test/mqtt-commands.test.ts
git commit -m "feat(server): add MQTT command parser, types, and fake client"
```

---

## Task 8: MQTT discovery payloads

A pure function that builds the HA discovery payloads for a given list of displays. No MQTT connection needed in this task — just JSON shapes.

**Files:**
- Create: `server/src/mqtt/discovery.ts`
- Create: `server/test/mqtt-discovery.test.ts`

- [ ] **Step 1: Write failing test `server/test/mqtt-discovery.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildDiscoveryPayloads, COSMOS_DEVICE_ID } from '../src/mqtt/discovery.js';

describe('buildDiscoveryPayloads', () => {
  it('emits a sensor + binary_sensor pair per display, with shared device metadata', () => {
    const out = buildDiscoveryPayloads([
      { id: 'd1', name: 'Living Room' },
      { id: 'd2', name: 'Kitchen' },
    ]);

    // 2 displays * 2 entities = 4 discovery topics
    expect(out.length).toBe(4);

    const sensorTopics = out.filter((p) => p.topic.includes('/sensor/'));
    expect(sensorTopics.length).toBe(2);
    const binTopics = out.filter((p) => p.topic.includes('/binary_sensor/'));
    expect(binTopics.length).toBe(2);

    const livingScene = out.find((p) => p.topic === `homeassistant/sensor/cosmos_d1_current_scene/config`);
    expect(livingScene).toBeDefined();
    const cfg = JSON.parse(livingScene!.payload);
    expect(cfg.name).toBe('Living Room Scene');
    expect(cfg.state_topic).toBe('cosmos/d1/current_scene');
    expect(cfg.unique_id).toBe('cosmos_d1_current_scene');
    expect(cfg.device.identifiers).toContain(COSMOS_DEVICE_ID);
  });

  it('emits an availability topic per display', () => {
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }]);
    const onlineCfg = JSON.parse(
      out.find((p) => p.topic.endsWith('cosmos_d1_online/config'))!.payload
    );
    expect(onlineCfg.state_topic).toBe('cosmos/d1/online');
    expect(onlineCfg.payload_on).toBe('online');
    expect(onlineCfg.payload_off).toBe('offline');
  });

  it('returns retain=true for all discovery payloads', () => {
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }]);
    expect(out.every((p) => p.retain === true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, see fail**

- [ ] **Step 3: Create `server/src/mqtt/discovery.ts`**

```ts
export const COSMOS_DEVICE_ID = 'cosmos_dashboard';

export type DiscoveryPayload = { topic: string; payload: string; retain: true };

export type DiscoveryDisplay = { id: string; name: string };

const COSMOS_DEVICE = {
  identifiers: [COSMOS_DEVICE_ID],
  name: 'Cosmos',
  manufacturer: 'Cosmos',
  model: 'Wall Dashboard',
};

export function buildDiscoveryPayloads(displays: DiscoveryDisplay[]): DiscoveryPayload[] {
  const out: DiscoveryPayload[] = [];
  for (const d of displays) {
    const sceneCfg = {
      name: `${d.name} Scene`,
      unique_id: `cosmos_${d.id}_current_scene`,
      state_topic: `cosmos/${d.id}/current_scene`,
      device: COSMOS_DEVICE,
    };
    out.push({
      topic: `homeassistant/sensor/cosmos_${d.id}_current_scene/config`,
      payload: JSON.stringify(sceneCfg),
      retain: true,
    });
    const onlineCfg = {
      name: `${d.name} Online`,
      unique_id: `cosmos_${d.id}_online`,
      state_topic: `cosmos/${d.id}/online`,
      payload_on: 'online',
      payload_off: 'offline',
      device_class: 'connectivity',
      device: COSMOS_DEVICE,
    };
    out.push({
      topic: `homeassistant/binary_sensor/cosmos_${d.id}_online/config`,
      payload: JSON.stringify(onlineCfg),
      retain: true,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run, see pass**

- [ ] **Step 5: Commit**

```bash
git add server/src/mqtt/discovery.ts server/test/mqtt-discovery.test.ts
git commit -m "feat(server): add MQTT discovery payload builder"
```

---

## Task 9: Real MQTT client + wire commands into the server

The real implementation uses the `mqtt` npm package. Wire it into `index.ts`: on startup, publish discovery; subscribe to `cosmos/+/#` and dispatch parsed commands; on socket connect/close, publish per-display online/offline; on scene change, publish current_scene state topic.

**Files:**
- Modify: `server/package.json` (add `mqtt`)
- Create: `server/src/mqtt/client.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Install**

```bash
npm --workspace server install mqtt
```

- [ ] **Step 2: Create `server/src/mqtt/client.ts`**

```ts
import { connectAsync, type MqttClient as RawMqttClient } from 'mqtt';
import type { MqttClient } from './types.js';

export async function makeMqttClient(url: string): Promise<MqttClient> {
  const raw: RawMqttClient = await connectAsync(url);
  const handlers: Array<{ filter: string; handler: (topic: string, payload: string) => void }> = [];

  raw.on('message', (topic, payload) => {
    const str = payload.toString();
    for (const h of handlers) {
      // mqtt's `subscribe` takes care of filter matching at broker level; we still get fired here
      h.handler(topic, str);
    }
  });

  return {
    publish(topic, payload, opts) {
      const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
      raw.publish(topic, str, { retain: opts?.retain ?? false });
    },
    subscribe(filter, handler) {
      handlers.push({ filter, handler });
      raw.subscribe(filter);
    },
    async close() {
      await raw.endAsync();
    },
  };
}
```

- [ ] **Step 3: Update `server/src/index.ts`** to wire MQTT — add to the existing `main()`:

After the HA setup (before the `app.listen`), insert:

```ts
  // MQTT setup
  let mqttClient: import('./mqtt/types.js').MqttClient | null = null;
  if (config.mqttUrl) {
    try {
      console.log(`connecting to MQTT at ${config.mqttUrl}`);
      const { makeMqttClient } = await import('./mqtt/client.js');
      mqttClient = await makeMqttClient(config.mqttUrl);
      console.log('MQTT connected');

      const { buildDiscoveryPayloads } = await import('./mqtt/discovery.js');
      const { parseCommandTopic } = await import('./mqtt/commands.js');

      function publishDiscovery() {
        if (!mqttClient) return;
        const list = displays.list().map((d) => ({ id: d.id, name: d.name }));
        for (const p of buildDiscoveryPayloads(list)) {
          mqttClient.publish(p.topic, p.payload, { retain: p.retain });
        }
      }
      publishDiscovery();

      mqttClient.subscribe('cosmos/+/message/set', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'show_message') return;
        dispatchOverlay(cmd.target, cmd.message);
      });
      mqttClient.subscribe('cosmos/+/message/dismiss', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'dismiss_message') return;
        dispatchDismiss(cmd.target);
      });
      mqttClient.subscribe('cosmos/+/scene/set', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'show_scene') return;
        dispatchShowScene(cmd.target, cmd.sceneName);
      });
    } catch (err) {
      console.error('MQTT connection failed; overlay/scene commands unavailable', err);
      mqttClient = null;
    }
  } else {
    console.log('MQTT_URL not set; overlay commands unavailable');
  }

  function resolveTargetDisplays(target: string): { id: string; name: string }[] {
    if (target === 'all') return displays.list().map((d) => ({ id: d.id, name: d.name }));
    const decoded = decodeURIComponent(target);
    const byName = displays.getByName(decoded);
    if (byName) return [{ id: byName.id, name: byName.name }];
    const byId = displays.getById(decoded);
    if (byId) return [{ id: byId.id, name: byId.name }];
    return [];
  }

  function dispatchOverlay(target: string, message: import('./overlay/types.js').OverlayMessage) {
    for (const d of resolveTargetDisplays(target)) wssRef?.pushOverlayTo(d.id, message);
  }
  function dispatchDismiss(target: string) {
    for (const d of resolveTargetDisplays(target)) wssRef?.dismissOverlayFor(d.id);
  }
  function dispatchShowScene(target: string, sceneName: string) {
    const scene = scenes.getByName(sceneName);
    if (!scene) return;
    for (const d of resolveTargetDisplays(target)) {
      displays.setCurrentScene(d.id, scene.id);
      void wssRef?.pushSceneTo(d.id);
    }
  }
```

Add `mqttClient?.close()` to the shutdown handler:

```ts
      await haClient?.close();
      await mqttClient?.close();
      db.close();
```

- [ ] **Step 4: Build**

```bash
npm --workspace server run build
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/package.json package-lock.json server/src/mqtt/client.ts server/src/index.ts
git commit -m "feat(server): wire real MQTT client with discovery + command dispatch"
```

---

## Task 10: Per-display online + current_scene state topics

When a display connects or disconnects, publish `cosmos/<id>/online`. When a display's active scene changes, publish `cosmos/<id>/current_scene`.

**Files:**
- Modify: `server/src/api/ws.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add hooks to `WsDeps`**

Replace `WsDeps` (preserving everything from earlier):

```ts
export type WsDeps = {
  displays: DisplaysRepo;
  scenes: ScenesRepo;
  settings: SettingsRepo;
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
  resolveEntity?: import('../scenes/assembler.js').EntityResolver;
  onDisplayOnline?: (displayId: string, name: string) => void;
  onDisplayOffline?: (displayId: string, name: string) => void;
  onSceneActivated?: (displayId: string, sceneName: string | null) => void;
};
```

In the `socket.on('message', ...)` handler — after `lastSceneByDisplay.delete(display.id)` and before sending the welcome payload — call:

```ts
      deps.onDisplayOnline?.(display.id, display.name);
```

In the `close` handler:

```ts
    socket.on('close', () => {
      if (!ownDisplayId) return;
      const set = sockets.get(ownDisplayId);
      set?.delete(socket);
      if (set && set.size === 0) {
        sockets.delete(ownDisplayId);
        lastSceneByDisplay.delete(ownDisplayId);
        const d = deps.displays.getById(ownDisplayId);
        if (d) deps.onDisplayOffline?.(ownDisplayId, d.name);
      }
    });
```

In `buildPayload`, after `lastSceneByDisplay.set(displayId, scene.id);`, also call the scene name hook:

```ts
    lastSceneByDisplay.set(displayId, scene.id);
    deps.onSceneActivated?.(displayId, scene.name);
```

- [ ] **Step 2: Wire the hooks in `server/src/index.ts`**

In the existing `main()`, just before `attachWsHub`, define:

```ts
  function publishOnline(displayId: string, _name: string) {
    mqttClient?.publish(`cosmos/${displayId}/online`, 'online', { retain: true });
  }
  function publishOffline(displayId: string, _name: string) {
    mqttClient?.publish(`cosmos/${displayId}/online`, 'offline', { retain: true });
  }
  function publishSceneState(displayId: string, sceneName: string | null) {
    mqttClient?.publish(`cosmos/${displayId}/current_scene`, sceneName ?? '', { retain: true });
  }
```

Then change the `attachWsHub` call:

```ts
  const wss = attachWsHub(app.server, {
    displays, scenes, settings, transitions, overrides, resolveEntity,
    onDisplayOnline: publishOnline,
    onDisplayOffline: publishOffline,
    onSceneActivated: publishSceneState,
  });
```

(Note: `mqttClient` is `let`-declared earlier in `main()`. These closures capture the `let` binding by reference, so they always read the current value — `null` when MQTT is disabled, the live client otherwise. Both publish helpers are no-ops when `mqttClient` is `null`.)

- [ ] **Step 3: Build**

```bash
npm --workspace server run build
```

Expected: exit 0.

- [ ] **Step 4: Run full suite**

```bash
npm --workspace server test
```

Expected: all green. The new hooks are optional (`?.`), so existing ws/scene-push tests are unaffected.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/ws.ts server/src/index.ts
git commit -m "feat(server): publish per-display online + current_scene MQTT state"
```

---

## Task 11: End-to-end smoke verification

Three checks: graceful no-HA/no-MQTT path, HA-disabled with a working overlay via direct WS push, and MQTT command via the fake client (driven from a Node script).

- [ ] **Step 1: Clean build**

```bash
rm -rf display/build server/dist data
npm run build
```

- [ ] **Step 2: Start the server with no HA, no MQTT**

```bash
DB_PATH="$(pwd)/data/cosmos.db" npm --workspace server start
```

Expected logs:
- `HA_URL/HA_TOKEN not set; using mock entity data`
- `MQTT_URL not set; overlay commands unavailable`
- `cosmos server listening on http://0.0.0.0:8099`

- [ ] **Step 3: Register, create scene, assign, open browser**

```bash
curl -s -X POST http://localhost:8099/api/displays/register -H 'content-type: application/json' -d '{"name":"Living Room"}'

SID=$(curl -s -X POST http://localhost:8099/api/scenes -H 'content-type: application/json' -d '{
  "name":"Now",
  "layout":{"cols":12,"rows":8,"items":[]},
  "background":{"type":"solid","color":"#0a0a14"},
  "typography":{"font_family":"Inter","font_scale":1.0},
  "widgets":[
    {"kind":"clock","position":{"col":1,"row":1,"w":12,"h":3},"config":{"format":"24h"}},
    {"kind":"entity_tile","position":{"col":1,"row":4,"w":4,"h":2},"config":{"entity_id":"light.living_room"}}
  ]
}' | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

curl -s -X POST "http://localhost:8099/api/displays/Living%20Room/scene/activate" -H 'content-type: application/json' -d "{\"sceneId\":\"$SID\"}"
```

Open the browser, onboard with `Living Room`. The Living Room Light entity should render with mock data ("on" + 71% brightness) — confirming the mock fallback when HA is disabled.

- [ ] **Step 4: Test overlay via direct WS path (no MQTT broker required)**

The simplest way to push an overlay without MQTT: run a Node script that uses the `ws` client to connect, hello, and verify a `pushOverlayToAll` would deliver. But we need to invoke the server-side push. Easier: temporarily expose an admin REST endpoint, OR add a simple Node script that uses the in-process `wssRef` — neither is in the plan as a permanent feature.

For end-to-end: use `mosquitto_pub` if Mosquitto is installed locally, or run the smoke MQTT test below.

If you have Mosquitto installed locally, restart the server with MQTT pointing at it:

```bash
# In one terminal
mosquitto -p 1883
# In another terminal
MQTT_URL=mqtt://localhost:1883 DB_PATH="$(pwd)/data/cosmos.db" npm --workspace server start
```

Then publish from yet another terminal:

```bash
mosquitto_pub -t 'cosmos/Living%20Room/message/set' -m '{"title":"Dinner is ready","timeout_ms":5000}'
```

The browser should show a toast that auto-dismisses after 5 seconds. Tapping it dismisses early.

To dismiss explicitly:

```bash
mosquitto_pub -t 'cosmos/Living%20Room/message/dismiss' -m ''
```

To switch scene by name:

```bash
mosquitto_pub -t 'cosmos/Living%20Room/scene/set' -m '{"scene_name":"Now"}'
```

If you don't have Mosquitto, skip this step — the unit tests cover the parser + dispatch loop.

- [ ] **Step 5: HA smoke (only if you run HA locally)**

If you have Home Assistant on your network with a long-lived token:

```bash
HA_URL=http://homeassistant.local:8123 HA_TOKEN=<your-token> MQTT_URL=mqtt://localhost:1883 DB_PATH="$(pwd)/data/cosmos.db" npm --workspace server start
```

Logs should show `Home Assistant connected; entity cache populated`. Recreate the scene above with a real entity_id from your HA (e.g., `light.kitchen`). The tile should now show real state. Toggle the light in HA — the tile should re-render automatically (entity cache update → reactive scene push).

In HA's Devices & Services, a "Cosmos" device should appear with `sensor.cosmos_<id>_current_scene` and `binary_sensor.cosmos_<id>_online` entities (auto-discovered via MQTT). Their values should reflect what Cosmos publishes.

- [ ] **Step 6: Run the full server test suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 7: Persistence check**

Stop the server. Restart with the same `DB_PATH`. Reload the browser — display + assigned scene + activated scene survive.

---

## Task 12: CLAUDE.md updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `server/CLAUDE.md`
- Modify: `display/CLAUDE.md`

- [ ] **Step 1: Append to root `CLAUDE.md` Architecture section**

```markdown
- `ha/` (server) — HA websocket client. Subscribes to `state_changed`, maintains an in-memory entity cache, fires reactive scene re-pushes when an active scene's widgets read an entity that changes.
- `mqtt/` (server) — MQTT client + HA discovery payload builder + command parser. Optional; degrades gracefully when `MQTT_URL` is unset.
- `overlay/` (server) — `OverlayMessage` type + WS push helpers (`pushOverlayTo`, `dismissOverlayFor`, …) for the toast/banner primitive.
```

In the WebSocket protocol section, add:

```markdown
- `{type: 'overlay', overlay: OverlayMessage}` — push a banner to the display.
- `{type: 'overlay_dismiss'}` — clear any visible banner.
```

In REST highlights, add a note (no new endpoint, but env vars):

```markdown
Optional env vars: `HA_URL` + `HA_TOKEN` enable HA integration; `MQTT_URL` enables MQTT command dispatch + HA discovery. Without them, Cosmos uses mock entity data and overlay commands are unavailable.
```

In Roadmap, replace Plan 4 with:

```markdown
- Plan 4: ✅ Shipped — HA + MQTT integration with reactive entity-driven scene push, MQTT discovery + command topics, message overlay primitive.
```

- [ ] **Step 2: Append to `server/CLAUDE.md`**

In Layout:

```markdown
- `src/ha/` — HA client interface, real implementation (`home-assistant-js-websocket`), in-memory entity cache, fake client for tests.
- `src/mqtt/` — MQTT client interface, real implementation (`mqtt`), command parser (pure), HA discovery payload builder, fake client for tests.
- `src/overlay/` — overlay message type.
```

In "Adding things":

```markdown
- A new MQTT command: extend `parseCommandTopic` in `mqtt/commands.ts` and the matching dispatcher in `index.ts`.
```

- [ ] **Step 3: Append to `display/CLAUDE.md`** Layout:

```markdown
- `src/lib/overlay/MessageOverlay.svelte` — toast/banner overlay layered above the scene canvas. Auto-dismisses on `timeout_ms`; tappable to dismiss early. Reduced-motion safe.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md server/CLAUDE.md display/CLAUDE.md
git commit -m "docs: update CLAUDE.md for HA + MQTT integration"
```

---

## Done criteria

- `npm test` is green for the server.
- Without `HA_URL`/`HA_TOKEN`, Cosmos uses mock entity data — entity tiles still render.
- Without `MQTT_URL`, Cosmos starts with overlay commands disabled — but everything else still works.
- With MQTT broker (e.g. Mosquitto) running and `MQTT_URL` set: publishing `cosmos/<display>/message/set` shows a toast; `cosmos/<display>/message/dismiss` clears it; `cosmos/<display>/scene/set` activates a scene by name.
- With HA running and credentials set: `entity_tile` widgets show real state; toggling the entity in HA updates the tile without a manual refresh; HA's Devices & Services shows a Cosmos device with per-display entities.
- Persistence still works.

The next plan (Plan 5: Editor UI) replaces curl-driven configuration with a Svelte editor served at `/admin`, surfaceable as an HA sidebar panel.
