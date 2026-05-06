# Cosmos Canvas Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `canvas` widget kind that renders user/agent-authored HTML/CSS/JS inside a sandboxed iframe with HA-side template rendering and a small read-only postMessage bridge.

**Architecture:** Canvas content is stored as a single string on `widget.config.content`. Server pipes the entire string through HA's `render_template` WS subscription (pin-for-pin compatible Jinja). The display renders the resolved string inside an `iframe sandbox="allow-scripts"` and forwards entity state changes to the iframe over `postMessage`. A small bridge script injected into `srcdoc` exposes `window.cosmos.{entity, subscribe, size, scene, font, ready}`.

**Tech Stack:** Same as the rest of Cosmos — Node + TS + Fastify + ws + better-sqlite3 on the server; SvelteKit + Svelte 4 + adapter-static on the display. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-05-canvas-widget-design.md`](../specs/2026-05-05-canvas-widget-design.md).

---

## Common Conventions

- Branch off `main`: `git checkout main && git checkout -b cosmos-canvas-widget`.
- TDD: failing test first, observe failure, implement, observe pass, commit.
- Conventional commits: `feat|fix|chore|refactor(scope): subject`.
- Stage exactly the files each task lists. No scratch files.
- All code in this plan is verbatim — copy as shown. Don't paraphrase.
- Bump `addon/config.yaml` `version:` once at the end of the plan (Task 12).

---

## File Structure

### New files

```
server/src/
  ha/
    templates.ts              # TemplatesClient — wraps HA's render_template WS subscription
  scenes/
    canvas.ts                 # resolveCanvas helper — bridges assembler → TemplatesClient
  api/
    canvases.ts               # POST /api/canvases/:widgetId/subscribe

display/src/lib/
  widgets/
    Canvas.svelte             # the widget — mounts iframe + postMessage bridge
    canvasBridge.ts           # bridge script as a const string (injected into srcdoc)
  admin/
    canvasExamples.ts         # five starter snippets for the Insert example dropdown
    canvas-help.md            # in-product "How this works" markdown

display/src/routes/
  preview-canvas/
    +page.svelte              # standalone preview page (?id=<widgetId>)

server/test/
  templates.test.ts           # TemplatesClient unit tests
  canvas.test.ts              # resolveCanvas unit tests

docs/
  canvas-widget.md            # user guide (~400-600 lines)
  canvas-widget-agent.md      # agent guide (~150 lines)
```

### Modified files

```
server/src/store/scenes.ts             # add 'canvas' to WidgetKind
server/src/scenes/types.ts             # add CanvasData
server/src/scenes/assembler.ts         # dataFor 'canvas' case + canvasResolver dep
server/src/api/http.ts                 # register canvases route + thread canvasResolver
server/src/api/ws.ts                   # WsDeps gains canvasResolver, plumb to assembler
server/src/index.ts                    # wire TemplatesClient + per-widget cleanups + extras-tracking
server/test/scenes.api.test.ts         # canvas roundtrip + subscribe endpoint tests
server/test/assembler.test.ts          # canvas data resolution test

display/src/lib/types.ts               # add 'canvas' to WidgetKind, add CanvasData
display/src/lib/scene/SceneCanvas.svelte    # dispatch 'canvas' to <Canvas>
display/src/lib/scene/WidgetSlot.svelte     # exempt data-kind='canvas' from edge-fade mask
display/src/routes/admin/scenes/[id]/+page.svelte  # editor controls + examples
display/src/lib/admin/api.ts           # canvases.subscribe(name, ids) helper

CLAUDE.md                              # canvas widget bullets
server/CLAUDE.md                       # TemplatesClient + canvases route
display/CLAUDE.md                      # Canvas.svelte + bridge

addon/config.yaml                      # bump version
```

---

## Tasks

### Task 1: Add `canvas` to WidgetKind on both sides + assembler stub

Adds the kind to both type definitions and a stubbed assembler case so existing tests still pass before any HA wiring lands.

**Files:**
- Modify: `server/src/store/scenes.ts`
- Modify: `display/src/lib/types.ts`
- Modify: `server/src/scenes/types.ts`
- Modify: `server/src/scenes/assembler.ts`
- Modify: `server/test/scenes.api.test.ts`

- [ ] **Step 1: Write failing API test for canvas roundtrip**

Append to `server/test/scenes.api.test.ts`:

```ts
  it('POST /api/scenes accepts a canvas widget and round-trips its content', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: {
        ...sample,
        widgets: [
          {
            kind: 'canvas',
            position: { col: 1, row: 1, w: 4, h: 4 },
            config: { content: '<h1>Hello {{ states("sensor.power") }}</h1>' },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.widgets[0].kind).toBe('canvas');
    expect(body.widgets[0].config.content).toBe('<h1>Hello {{ states("sensor.power") }}</h1>');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server test -- scenes.api`
Expected: FAIL — server's `WidgetKind` doesn't include `'canvas'` yet (validator rejects it OR TS error if widgets-array validation tightens later).

- [ ] **Step 3: Add `'canvas'` to WidgetKind on the server**

In `server/src/store/scenes.ts`, change the `WidgetKind` union:

```ts
export type WidgetKind = 'clock' | 'weather' | 'entity_tile' | 'calendar' | 'media_player' | 'statistics' | 'text' | 'camera' | 'canvas';
```

- [ ] **Step 4: Add CanvasData to server scene types**

In `server/src/scenes/types.ts`, after the existing `StatisticsData` block:

```ts
export type CanvasData = {
  /** Content with Jinja templates already substituted by HA. */
  resolved: string;
  /** Entity ids the rendered template depends on, plus any iframe-side
   *  subscriptions registered via POST /api/canvases/:widgetId/subscribe. */
  liveEntityIds: string[];
};
```

Then add `CanvasData` to the `WidgetData` union:

```ts
export type WidgetData =
  | ClockData
  | WeatherData
  | EntityTileData
  | CalendarData
  | MediaPlayerData
  | StatisticsData
  | CameraData
  | CanvasData;
```

- [ ] **Step 5: Stub the assembler case**

In `server/src/scenes/assembler.ts`, add a case to `dataFor()` (alongside the others, before the closing brace of the switch):

```ts
    case 'canvas': {
      const cfg = widget.config as { content?: unknown };
      const content = typeof cfg.content === 'string' ? cfg.content : '';
      // Without a canvasResolver wired in (added in Task 4), pass content
      // through unchanged so existing scenes keep rendering.
      if (!deps.canvasResolver) {
        return { resolved: content, liveEntityIds: [] };
      }
      const result = await deps.canvasResolver(widget.id, content);
      return { resolved: result.resolved, liveEntityIds: result.entityIds };
    }
```

Then extend `DataResolvers` (same file):

```ts
export type DataResolvers = {
  resolveEntity?: EntityResolver;
  resolveCalendarEvents?: (entityId: string, opts: { start: Date; end: Date }) => Promise<CalendarEvent[]>;
  resolveHistory?: (entityId: string, opts: { start: Date; end: Date }) => Promise<StatisticsPoint[]>;
  resolveWeatherForecasts?: (entityId: string, type: WeatherForecastType) => Promise<WeatherForecastItem[]>;
  readEntitySync?: (entityId: string) => EntityState | null;
  mediaUrlBase?: string;
  /** Resolve a canvas widget's content via HA's template engine. Returns
   *  the substituted string and the entity ids it depends on. Without
   *  this resolver, canvas widgets render as-is with literal {{ }} marks. */
  canvasResolver?: (widgetId: string, content: string) => Promise<{ resolved: string; entityIds: string[] }>;
};
```

Add to `AssemblePushArgs` similarly:

```ts
export type AssemblePushArgs = {
  scene: Scene;
  safeArea: { top: number; right: number; bottom: number; left: number };
  previousSceneId: string | null;
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
  explicitTransitionId?: string | null;
  resolver?: EntityResolver;
  resolveCalendarEvents?: DataResolvers['resolveCalendarEvents'];
  resolveHistory?: DataResolvers['resolveHistory'];
  resolveWeatherForecasts?: DataResolvers['resolveWeatherForecasts'];
  readEntitySync?: DataResolvers['readEntitySync'];
  mediaUrlBase?: string;
  canvasResolver?: DataResolvers['canvasResolver'];
};
```

And pass it in `assemblePush()`:

```ts
  const state = await buildSceneState(args.scene, args.safeArea, {
    resolveEntity: args.resolver,
    resolveCalendarEvents: args.resolveCalendarEvents,
    resolveHistory: args.resolveHistory,
    resolveWeatherForecasts: args.resolveWeatherForecasts,
    readEntitySync: args.readEntitySync,
    mediaUrlBase: args.mediaUrlBase,
    canvasResolver: args.canvasResolver,
  });
```

- [ ] **Step 6: Mirror on the display**

In `display/src/lib/types.ts`:

```ts
export type WidgetKind = 'clock' | 'weather' | 'entity_tile' | 'calendar' | 'media_player' | 'statistics' | 'text' | 'camera' | 'canvas';
```

Add the matching `CanvasData` and add it to the `WidgetData` union. Use the same shape as the server type:

```ts
export type CanvasData = {
  resolved: string;
  liveEntityIds: string[];
};
```

- [ ] **Step 7: Run server tests**

Run: `npm --workspace server test`
Expected: PASS — including the new roundtrip test from Step 1.

- [ ] **Step 8: Commit**

```bash
git add server/src/store/scenes.ts server/src/scenes/types.ts server/src/scenes/assembler.ts server/test/scenes.api.test.ts display/src/lib/types.ts
git commit -m "feat(canvas): add WidgetKind + CanvasData scaffolding"
```

---

### Task 2: TemplatesClient — initial render via HA

Builds the HA-side template-rendering surface as a tested, standalone module with a fake HA connection. We do this BEFORE wiring it into the assembler so the unit tests cover the API.

**Files:**
- Create: `server/src/ha/templates.ts`
- Create: `server/test/templates.test.ts`

- [ ] **Step 1: Write failing test for one-shot render**

Create `server/test/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createTemplatesClient } from '../src/ha/templates.js';
import { createFakeHaConnection } from './helpers/fakeHaConn.js';

describe('TemplatesClient', () => {
  it('renders a template once and reports its dependent entities', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('Power: {{ states("sensor.power") }} W', {
      result: 'Power: 42 W',
      listeners: { entities: ['sensor.power'], all: false, time: false },
    });
    const tc = createTemplatesClient(conn);
    const r = await tc.render('Power: {{ states("sensor.power") }} W', () => {});
    expect(r.initial).toBe('Power: 42 W');
    expect(r.entityIds).toEqual(['sensor.power']);
  });
});
```

- [ ] **Step 2: Create the fake HA connection helper**

Create `server/test/helpers/fakeHaConn.ts`:

```ts
import type { Connection } from 'home-assistant-js-websocket';

type Sub = { template: string; onMessage: (msg: unknown) => void; onError?: (err: unknown) => void };
type Queued = { result: string; listeners: { entities: string[]; all: boolean; time: boolean } };

export type FakeHaConnection = Connection & {
  queueRenderTemplate(template: string, response: Queued): void;
  pushUpdate(template: string, response: Queued): void;
  countSubscriptions(): number;
};

export function createFakeHaConnection(): FakeHaConnection {
  const queued = new Map<string, Queued[]>();
  const active = new Map<string, Sub[]>();
  let nextId = 1;

  // Minimal Connection surface used by TemplatesClient + tests.
  const conn = {
    addEventListener: () => {},
    removeEventListener: () => {},
    close: () => {},
    sendMessagePromise: async (msg: { type: string; template: string }) => {
      // Cosmos's TemplatesClient uses subscribeMessage, not sendMessagePromise,
      // for render_template. Kept here for completeness.
      void msg;
      return {};
    },
    subscribeMessage: <T>(
      cb: (msg: T) => void,
      msg: { type: string; template: string },
    ) => {
      if (msg.type !== 'render_template') {
        throw new Error(`fake HA: unexpected subscribe type ${msg.type}`);
      }
      const list = active.get(msg.template) ?? [];
      list.push({ template: msg.template, onMessage: cb as (m: unknown) => void });
      active.set(msg.template, list);
      // Flush any queued initial response for this template.
      const q = queued.get(msg.template) ?? [];
      const next = q.shift();
      if (next) (cb as (m: unknown) => void)(next);
      const id = nextId++;
      void id;
      return Promise.resolve(() => {
        const remaining = (active.get(msg.template) ?? []).filter((s) => s.onMessage !== cb);
        if (remaining.length === 0) active.delete(msg.template);
        else active.set(msg.template, remaining);
      });
    },
    queueRenderTemplate(template: string, response: Queued) {
      const list = queued.get(template) ?? [];
      list.push(response);
      queued.set(template, list);
    },
    pushUpdate(template: string, response: Queued) {
      const list = active.get(template) ?? [];
      for (const s of list) s.onMessage(response);
    },
    countSubscriptions() {
      let n = 0;
      for (const list of active.values()) n += list.length;
      return n;
    },
  } as unknown as FakeHaConnection;

  return conn;
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace server test -- templates`
Expected: FAIL — `createTemplatesClient` doesn't exist yet.

- [ ] **Step 4: Implement TemplatesClient (one-shot path)**

Create `server/src/ha/templates.ts`:

```ts
import type { Connection } from 'home-assistant-js-websocket';

export type TemplateRender = {
  initial: string;
  entityIds: string[];
  unsubscribe: () => void;
};

export type TemplatesClient = {
  /** Render a template via HA and subscribe for updates. Multiple callers
   *  requesting the same template string share one underlying HA
   *  subscription (ref-counted). The returned `unsubscribe` decrements
   *  the count; the HA subscription closes when the count hits zero. */
  render(
    template: string,
    onUpdate: (rendered: string, entityIds: string[]) => void,
  ): Promise<TemplateRender>;
  close(): void;
};

type Shared = {
  template: string;
  callbacks: Set<(rendered: string, entityIds: string[]) => void>;
  haUnsubscribe: () => void;
  lastResult: string;
  lastEntityIds: string[];
};

type RenderTemplateMsg = {
  result?: string;
  error?: string;
  listeners?: { entities?: string[]; all?: boolean; time?: boolean };
};

export function createTemplatesClient(conn: Connection): TemplatesClient {
  const shared = new Map<string, Shared>();
  let closed = false;

  async function ensure(template: string): Promise<Shared> {
    const existing = shared.get(template);
    if (existing) return existing;

    let resolveFirst: (s: Shared) => void;
    let rejectFirst: (err: unknown) => void;
    const firstPromise = new Promise<Shared>((res, rej) => {
      resolveFirst = res;
      rejectFirst = rej;
    });

    let initialised = false;
    let entry: Shared | null = null;

    const handler = (msg: RenderTemplateMsg) => {
      const result = typeof msg.result === 'string' ? msg.result : (msg.error ?? '');
      const entityIds = msg.listeners?.entities ?? [];
      if (!initialised) {
        initialised = true;
        const haUnsubscribe = pendingUnsubscribe ?? (() => {});
        const e: Shared = {
          template,
          callbacks: new Set(),
          haUnsubscribe,
          lastResult: result,
          lastEntityIds: entityIds,
        };
        entry = e;
        shared.set(template, e);
        resolveFirst(e);
        return;
      }
      if (!entry) return;
      entry.lastResult = result;
      entry.lastEntityIds = entityIds;
      for (const cb of entry.callbacks) cb(result, entityIds);
    };

    let pendingUnsubscribe: (() => void) | null = null;
    try {
      pendingUnsubscribe = await conn.subscribeMessage<RenderTemplateMsg>(handler, {
        type: 'render_template',
        template,
      });
    } catch (err) {
      rejectFirst!(err);
      throw err;
    }
    // If the handler already fired synchronously (some fakes do), `entry` is set.
    if (entry) (entry as Shared).haUnsubscribe = pendingUnsubscribe;
    return firstPromise;
  }

  return {
    async render(template, onUpdate) {
      if (closed) throw new Error('TemplatesClient closed');
      const entry = await ensure(template);
      entry.callbacks.add(onUpdate);
      return {
        initial: entry.lastResult,
        entityIds: entry.lastEntityIds,
        unsubscribe: () => {
          entry.callbacks.delete(onUpdate);
          if (entry.callbacks.size === 0) {
            entry.haUnsubscribe();
            shared.delete(template);
          }
        },
      };
    },
    close() {
      closed = true;
      for (const e of shared.values()) e.haUnsubscribe();
      shared.clear();
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace server test -- templates`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/ha/templates.ts server/test/templates.test.ts server/test/helpers/fakeHaConn.ts
git commit -m "feat(canvas): TemplatesClient one-shot render via HA"
```

---

### Task 3: TemplatesClient — ref-counted sharing + live updates + errors

Adds the rest of the Section 2 behaviour: shared subscriptions across callers, push updates, error surfacing.

**Files:**
- Modify: `server/test/templates.test.ts`

- [ ] **Step 1: Write three failing tests**

Append to `server/test/templates.test.ts`:

```ts
  it('shares one HA subscription across callers requesting the same template', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('A', { result: '1', listeners: { entities: ['x'], all: false, time: false } });
    const tc = createTemplatesClient(conn);
    const r1 = await tc.render('A', () => {});
    const r2 = await tc.render('A', () => {});
    expect(conn.countSubscriptions()).toBe(1);
    r1.unsubscribe();
    expect(conn.countSubscriptions()).toBe(1);  // still one caller left
    r2.unsubscribe();
    expect(conn.countSubscriptions()).toBe(0);  // last caller dropped → unsub
  });

  it('pushes updates to all subscribers when the template re-renders', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('B', { result: '1', listeners: { entities: ['x'], all: false, time: false } });
    const tc = createTemplatesClient(conn);
    const calls: string[] = [];
    await tc.render('B', (rendered) => calls.push(rendered));
    conn.pushUpdate('B', { result: '2', listeners: { entities: ['x'], all: false, time: false } });
    expect(calls).toEqual(['2']);
  });

  it('surfaces HA template errors as the rendered value', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('OOPS', {
      result: '',
      listeners: { entities: [], all: false, time: false },
    });
    // Override: simulate HA returning an error response by pushing a message
    // with `error` and no `result`. We re-queue manually:
    const tc = createTemplatesClient(conn);
    // First the template is registered with the queued (empty) result, then
    // an error update arrives.
    const r = await tc.render('OOPS', () => {});
    expect(r.initial).toBe('');
    // The fake's pushUpdate calls all subscribers. We extend its message
    // shape to include `error`.
    let received = '';
    await tc.render('OOPS', (s) => { received = s; });
    (conn as unknown as { pushUpdate(t: string, msg: unknown): void }).pushUpdate('OOPS', {
      error: 'TemplateSyntaxError: unexpected end of template',
    });
    expect(received).toBe('TemplateSyntaxError: unexpected end of template');
  });
```

- [ ] **Step 2: Run tests to verify failures**

Run: `npm --workspace server test -- templates`
Expected: PASS for the first two (TemplatesClient already supports them); FAIL only if the error case isn't handled correctly. If all three pass already, that's fine — the spec is met. Move on.

- [ ] **Step 3: Commit**

```bash
git add server/test/templates.test.ts
git commit -m "test(canvas): TemplatesClient ref-counting + updates + errors"
```

---

### Task 4: resolveCanvas helper + assembler integration test

Builds the small bridge between assembler and TemplatesClient. Includes per-widget cleanup tracking so re-resolves drop the previous subscription.

**Files:**
- Create: `server/src/scenes/canvas.ts`
- Create: `server/test/canvas.test.ts`
- Modify: `server/test/assembler.test.ts`

- [ ] **Step 1: Write failing test for resolveCanvas pass-through (no client)**

Create `server/test/canvas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createCanvasResolver } from '../src/scenes/canvas.js';

describe('resolveCanvas', () => {
  it('returns content unchanged when no templates client is provided', async () => {
    const resolver = createCanvasResolver(null, () => {});
    const r = await resolver('w1', '<h1>Hello {{ states("sensor.power") }}</h1>');
    expect(r.resolved).toBe('<h1>Hello {{ states("sensor.power") }}</h1>');
    expect(r.entityIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --workspace server test -- canvas.test`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement resolveCanvas**

Create `server/src/scenes/canvas.ts`:

```ts
import type { TemplatesClient } from '../ha/templates.js';

export type CanvasResolver = (widgetId: string, content: string) => Promise<{
  resolved: string;
  entityIds: string[];
}>;

/**
 * Builds a resolver function that the assembler calls for every canvas
 * widget on every scene assemble. Maintains a per-widget cleanup map so
 * re-resolving a widget (after a content edit) drops the previous HA
 * subscription before registering the new one.
 *
 * `onUpdate(widgetId)` fires whenever any of widget `widgetId`'s templates
 * re-renders (i.e., an entity it depends on changed). The host wires this
 * to the existing `markDisplayDirty` machinery so the scene re-pushes.
 */
export function createCanvasResolver(
  templates: TemplatesClient | null,
  onUpdate: (widgetId: string) => void,
): CanvasResolver & { dispose(widgetId?: string): void } {
  const cleanups = new Map<string, () => void>();

  const resolver: CanvasResolver = async (widgetId, content) => {
    // Drop any previous subscription for this widget.
    cleanups.get(widgetId)?.();
    cleanups.delete(widgetId);

    if (!templates || !content) {
      return { resolved: content, entityIds: [] };
    }

    let lastResult = '';
    let lastEntities: string[] = [];
    const r = await templates.render(content, (rendered, entityIds) => {
      lastResult = rendered;
      lastEntities = entityIds;
      onUpdate(widgetId);
    });
    lastResult = r.initial;
    lastEntities = r.entityIds;
    cleanups.set(widgetId, r.unsubscribe);
    return { resolved: lastResult, entityIds: lastEntities };
  };

  return Object.assign(resolver, {
    dispose(widgetId?: string) {
      if (widgetId === undefined) {
        for (const c of cleanups.values()) c();
        cleanups.clear();
        return;
      }
      cleanups.get(widgetId)?.();
      cleanups.delete(widgetId);
    },
  });
}
```

- [ ] **Step 4: Add the with-client test**

Append to `server/test/canvas.test.ts`:

```ts
import { createTemplatesClient } from '../src/ha/templates.js';
import { createFakeHaConnection } from './helpers/fakeHaConn.js';

describe('resolveCanvas with templates client', () => {
  it('renders templates and reports dependent entities', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('<p>{{ states("x") }}</p>', {
      result: '<p>42</p>',
      listeners: { entities: ['x'], all: false, time: false },
    });
    const tc = createTemplatesClient(conn);
    const resolver = createCanvasResolver(tc, () => {});
    const r = await resolver('w1', '<p>{{ states("x") }}</p>');
    expect(r.resolved).toBe('<p>42</p>');
    expect(r.entityIds).toEqual(['x']);
  });

  it('fires onUpdate when the underlying template re-renders', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('T', { result: '1', listeners: { entities: ['e'], all: false, time: false } });
    const tc = createTemplatesClient(conn);
    const updated: string[] = [];
    const resolver = createCanvasResolver(tc, (id) => updated.push(id));
    await resolver('wA', 'T');
    conn.pushUpdate('T', { result: '2', listeners: { entities: ['e'], all: false, time: false } });
    expect(updated).toEqual(['wA']);
  });

  it('drops the previous subscription when a widget re-resolves', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('A', { result: 'a', listeners: { entities: [], all: false, time: false } });
    conn.queueRenderTemplate('B', { result: 'b', listeners: { entities: [], all: false, time: false } });
    const tc = createTemplatesClient(conn);
    const resolver = createCanvasResolver(tc, () => {});
    await resolver('wX', 'A');
    expect(conn.countSubscriptions()).toBe(1);
    await resolver('wX', 'B');
    expect(conn.countSubscriptions()).toBe(1);  // A dropped, B registered
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm --workspace server test -- canvas.test templates`
Expected: PASS.

- [ ] **Step 6: Add assembler test**

Append to `server/test/assembler.test.ts`:

```ts
  it('returns CanvasData with literal template marks when no canvasResolver is wired', async () => {
    const scene: Scene = {
      ...sample,
      widgets: [
        {
          id: 'c1',
          kind: 'canvas',
          position: { col: 1, row: 1, w: 4, h: 4 },
          config: { content: '<h1>{{ states("sensor.power") }}</h1>' },
        },
      ],
    } as Scene;
    const state = await buildSceneState(scene, { top: 0, right: 0, bottom: 0, left: 0 });
    const widget = state.widgets[0];
    expect(widget.kind).toBe('canvas');
    expect(widget.data).toEqual({ resolved: '<h1>{{ states("sensor.power") }}</h1>', liveEntityIds: [] });
  });

  it('uses the canvasResolver when provided', async () => {
    const scene: Scene = {
      ...sample,
      widgets: [
        {
          id: 'c2',
          kind: 'canvas',
          position: { col: 1, row: 1, w: 4, h: 4 },
          config: { content: '<h1>{{ states("x") }}</h1>' },
        },
      ],
    } as Scene;
    const state = await buildSceneState(scene, { top: 0, right: 0, bottom: 0, left: 0 }, {
      canvasResolver: async (id, content) => ({ resolved: '<h1>42</h1>', entityIds: ['x'] }),
    });
    expect(state.widgets[0].data).toEqual({ resolved: '<h1>42</h1>', liveEntityIds: ['x'] });
  });
```

- [ ] **Step 7: Run tests**

Run: `npm --workspace server test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/scenes/canvas.ts server/test/canvas.test.ts server/test/assembler.test.ts
git commit -m "feat(canvas): resolveCanvas helper + assembler integration"
```

---

### Task 5: Subscribe endpoint + per-display extras tracking

Adds the iframe-side `cosmos.subscribe('sensor.foo')` HTTP path. Extras are scoped per (display, widget) and merged into `liveEntityIds` on assemble.

**Files:**
- Create: `server/src/api/canvases.ts`
- Modify: `server/src/api/http.ts`
- Modify: `server/src/scenes/assembler.ts`
- Modify: `server/test/scenes.api.test.ts`

- [ ] **Step 1: Write failing endpoint test**

Append to `server/test/scenes.api.test.ts`:

```ts
  it('POST /api/canvases/:widgetId/subscribe records extras and returns 204', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvases/w1/subscribe',
      payload: { display_name: 'Living Room', entity_ids: ['sensor.power', 'sensor.temp'] },
    });
    expect(res.statusCode).toBe(204);
  });

  it('POST /api/canvases/:widgetId/subscribe rejects malformed bodies', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvases/w1/subscribe',
      payload: { entity_ids: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --workspace server test -- scenes.api`
Expected: FAIL — endpoint doesn't exist.

- [ ] **Step 3: Implement the endpoint**

Create `server/src/api/canvases.ts`:

```ts
import type { FastifyInstance } from 'fastify';

/** Per-(display, widget) set of entity ids the iframe has subscribed to
 *  beyond what the rendered template depends on. The host plumbs the
 *  read function into the assembler so liveEntityIds is the union. */
export type CanvasExtrasStore = {
  add(displayName: string, widgetId: string, entityIds: string[]): void;
  list(displayName: string, widgetId: string): string[];
  /** Drop all extras for the given display (called from the WS hub when
   *  a display disconnects). */
  clearDisplay(displayName: string): void;
};

export function createCanvasExtrasStore(): CanvasExtrasStore {
  // displayName → widgetId → Set<entityId>
  const byDisplay = new Map<string, Map<string, Set<string>>>();
  return {
    add(displayName, widgetId, entityIds) {
      let perDisplay = byDisplay.get(displayName);
      if (!perDisplay) {
        perDisplay = new Map();
        byDisplay.set(displayName, perDisplay);
      }
      let perWidget = perDisplay.get(widgetId);
      if (!perWidget) {
        perWidget = new Set();
        perDisplay.set(widgetId, perWidget);
      }
      for (const id of entityIds) perWidget.add(id);
    },
    list(displayName, widgetId) {
      const perWidget = byDisplay.get(displayName)?.get(widgetId);
      return perWidget ? Array.from(perWidget) : [];
    },
    clearDisplay(displayName) {
      byDisplay.delete(displayName);
    },
  };
}

export type CanvasRoutesDeps = {
  extras: CanvasExtrasStore;
  /** Called after an extras update so the host can mark the affected
   *  display dirty and re-push. */
  onExtrasChanged?: (displayName: string) => void;
};

export function registerCanvasRoutes(app: FastifyInstance, deps: CanvasRoutesDeps): void {
  app.post<{
    Params: { widgetId: string };
    Body: { display_name?: unknown; entity_ids?: unknown };
  }>('/api/canvases/:widgetId/subscribe', async (req, reply) => {
    const widgetId = req.params.widgetId;
    const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name : null;
    const entityIds = Array.isArray(req.body?.entity_ids)
      ? req.body!.entity_ids.filter((x: unknown): x is string => typeof x === 'string')
      : null;
    if (!displayName || !entityIds) {
      return reply.code(400).send({ error: 'display_name (string) and entity_ids (string[]) required' });
    }
    deps.extras.add(displayName, widgetId, entityIds);
    deps.onExtrasChanged?.(displayName);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Wire it into http.ts**

Modify `server/src/api/http.ts`:

```ts
import { registerCanvasRoutes, createCanvasExtrasStore, type CanvasExtrasStore } from './canvases.js';
```

Add to `HttpDeps`:

```ts
  canvasExtras?: CanvasExtrasStore;
  onCanvasExtrasChanged?: (displayName: string) => void;
```

In `buildHttpApp()`, after the other route registrations:

```ts
  if (deps.canvasExtras) {
    registerCanvasRoutes(app, {
      extras: deps.canvasExtras,
      onExtrasChanged: deps.onCanvasExtrasChanged,
    });
  }
```

- [ ] **Step 5: Wire `canvasExtras` into the test setup**

In `server/test/scenes.api.test.ts`, find the `setup()` helper and pass through a fresh extras store. Modify the existing `app = await buildHttpApp(ctx)` call site so the build includes a `canvasExtras` store. If `setup()` returns a context object, add to it:

```ts
import { createCanvasExtrasStore } from '../src/api/canvases.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  const canvasExtras = createCanvasExtrasStore();
  return { displays, settings, scenes, transitions, overrides, canvasExtras };
}
```

- [ ] **Step 6: Plumb extras into the assembler**

In `server/src/scenes/assembler.ts`, extend `DataResolvers`:

```ts
  /** Per-display extras for canvas widgets — entity ids the iframe has
   *  subscribed to beyond what the rendered template depends on. Returns
   *  an empty array when not provided. */
  canvasExtras?: (widgetId: string) => string[];
```

In the canvas `case` of `dataFor()`, merge:

```ts
    case 'canvas': {
      const cfg = widget.config as { content?: unknown };
      const content = typeof cfg.content === 'string' ? cfg.content : '';
      const extras = deps.canvasExtras ? deps.canvasExtras(widget.id) : [];
      if (!deps.canvasResolver) {
        const liveEntityIds = Array.from(new Set(extras));
        return { resolved: content, liveEntityIds };
      }
      const result = await deps.canvasResolver(widget.id, content);
      const liveEntityIds = Array.from(new Set([...result.entityIds, ...extras]));
      return { resolved: result.resolved, liveEntityIds };
    }
```

Add `canvasExtras` to `AssemblePushArgs` in the same way `canvasResolver` was added; pass through in `assemblePush()`.

- [ ] **Step 7: Run tests**

Run: `npm --workspace server test`
Expected: PASS — all existing tests + new endpoint tests.

- [ ] **Step 8: Commit**

```bash
git add server/src/api/canvases.ts server/src/api/http.ts server/src/scenes/assembler.ts server/test/scenes.api.test.ts
git commit -m "feat(canvas): subscribe endpoint + per-display extras"
```

---

### Task 6: Wire TemplatesClient + canvasExtras into the running server

Connects the new pieces in `index.ts` so a real HA connection produces a working canvasResolver and the WS hub clears extras on disconnect.

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/src/api/ws.ts`

- [ ] **Step 1: Construct TemplatesClient + extras store + canvasResolver**

In `server/src/index.ts`, after the HaClient is created (find the block where `haClient` is set), import and create:

```ts
import { createTemplatesClient } from './ha/templates.js';
import { createCanvasResolver } from './scenes/canvas.js';
import { createCanvasExtrasStore } from './api/canvases.js';
```

After the HaClient block:

```ts
  const templatesClient = haClient ? createTemplatesClient(haClient.connection) : null;
  const canvasExtras = createCanvasExtrasStore();
  const canvasResolver = createCanvasResolver(templatesClient, (widgetId) => {
    // Mark every display whose active scene contains this widget dirty.
    for (const d of displays.list()) {
      const activeId = d.currentSceneId ?? d.defaultSceneId;
      if (!activeId) continue;
      const scene = scenes.get(activeId);
      if (!scene) continue;
      if (scene.widgets.some((w) => w.id === widgetId)) markDisplayDirty(d.id);
    }
  });
```

Note: `haClient.connection` needs to be exposed. Check `server/src/ha/types.ts` for the `HaClient` type — if `connection` isn't there yet, add it (alongside the existing `getEntity`, `onStateChanged`, etc.). Pass through from `client.ts`'s `makeHaClient`.

- [ ] **Step 2: Pass canvasResolver + extras through buildHttpApp**

Find the existing `buildHttpApp({...})` call and add:

```ts
    canvasExtras,
    onCanvasExtrasChanged: (displayName) => {
      // Find the display by name and mark dirty.
      const d = displays.getByName(displayName);
      if (d) markDisplayDirty(d.id);
    },
```

- [ ] **Step 3: Pass canvasResolver + canvasExtras into the WS hub**

In `server/src/api/ws.ts`, extend `WsDeps`:

```ts
  canvasResolver?: import('../scenes/assembler.js').DataResolvers['canvasResolver'];
  canvasExtras?: import('../scenes/assembler.js').DataResolvers['canvasExtras'];
```

Find the `assemblePush({...})` call inside `buildPayload()` and pass through:

```ts
      canvasResolver: deps.canvasResolver,
      canvasExtras: deps.canvasExtras,
```

In `server/src/index.ts`, the `attachWsHub({...})` call gains:

```ts
    canvasResolver,
    canvasExtras: (widgetId) => {
      // The ws.ts hub doesn't know which display the active push is for at
      // this resolver layer; we accept that and pass extras keyed by widget
      // ONLY (display-keyed extras require display name be threaded in).
      // Simpler v1 path: extras are per-display in the store, but the
      // assembler only sees the union across displays. For v1 we accept
      // the mild over-subscription (one display's extra subscriptions
      // appear in another display's liveEntityIds — harmless because the
      // iframe-side bridge filters by what cosmos.subscribe registered).
      const all: string[] = [];
      for (const d of displays.list()) all.push(...canvasExtras.list(d.name, widgetId));
      return all;
    },
```

- [ ] **Step 4: Clear extras on display disconnect**

In `server/src/api/ws.ts`, find the `socket.on('close', ...)` handler and add:

```ts
        if (d) {
          deps.onDisplayOffline?.(ownDisplayId, d.name);
          deps.canvasExtrasOnDisconnect?.(d.name);
        }
```

Add `canvasExtrasOnDisconnect?: (displayName: string) => void;` to `WsDeps`.

In `server/src/index.ts`, pass:

```ts
    canvasExtrasOnDisconnect: (displayName) => canvasExtras.clearDisplay(displayName),
```

- [ ] **Step 5: Build + run all tests**

Run: `npm --workspace server run build && npm --workspace server test`
Expected: PASS — typecheck clean, all tests green.

- [ ] **Step 6: Commit**

```bash
git add server/src/index.ts server/src/api/ws.ts server/src/ha/types.ts server/src/ha/client.ts
git commit -m "feat(canvas): wire TemplatesClient + canvasExtras into runtime"
```

---

### Task 7: Canvas.svelte + bridge script

Builds the display-side widget. Iframe + sandbox + injected bridge.

**Files:**
- Create: `display/src/lib/widgets/canvasBridge.ts`
- Create: `display/src/lib/widgets/Canvas.svelte`
- Modify: `display/src/lib/scene/SceneCanvas.svelte`
- Modify: `display/src/lib/scene/WidgetSlot.svelte`
- Modify: `display/src/lib/admin/api.ts`

- [ ] **Step 1: Create the bridge script as a string constant**

Create `display/src/lib/widgets/canvasBridge.ts`:

```ts
/** The bridge script string injected into every canvas iframe's `srcdoc`.
 *  Runs inside the iframe with origin `null`. Communicates with the parent
 *  via `postMessage`. Read-only — no service calls, no mutation. */
export const CANVAS_BRIDGE_SCRIPT = `
<script>
(function () {
  var COSMOS_VERSION = '1.0.0';
  var entitiesById = {};
  var subscribers = {};
  var resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });

  var cosmos = {
    size: { w: 0, h: 0 },
    scene: { id: '', name: '' },
    font: { family: 'system-ui', scale: 1 },
    version: COSMOS_VERSION,
    ready: ready,
    entity: function (id) { return entitiesById[id] || null; },
    subscribe: function (id, cb) {
      var list = subscribers[id] || (subscribers[id] = []);
      list.push(cb);
      if (entitiesById[id]) cb(entitiesById[id]);
      else {
        // Ask parent to start tracking this entity.
        try { window.parent.postMessage({ type: 'cosmos:want-entity', entity_ids: [id] }, '*'); } catch (e) {}
      }
      return function () {
        var i = (subscribers[id] || []).indexOf(cb);
        if (i >= 0) subscribers[id].splice(i, 1);
      };
    },
  };
  window.cosmos = cosmos;

  function applyContext(ctx) {
    if (ctx.size) { cosmos.size.w = ctx.size.w; cosmos.size.h = ctx.size.h; }
    if (ctx.scene) { cosmos.scene.id = ctx.scene.id; cosmos.scene.name = ctx.scene.name; }
    if (ctx.font) { cosmos.font.family = ctx.font.family; cosmos.font.scale = ctx.font.scale; }
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var msg = ev.data;
    if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('cosmos:') !== 0) return;
    if (msg.type === 'cosmos:init') {
      applyContext(msg.context || {});
      var list = msg.entities || [];
      for (var i = 0; i < list.length; i++) entitiesById[list[i].entity_id] = list[i];
      resolveReady && resolveReady();
    } else if (msg.type === 'cosmos:state') {
      var e = msg.entity;
      if (!e || typeof e.entity_id !== 'string') return;
      entitiesById[e.entity_id] = e;
      var subs = subscribers[e.entity_id] || [];
      for (var j = 0; j < subs.length; j++) {
        try { subs[j](e); } catch (err) { /* iframe author bug; swallow */ }
      }
    } else if (msg.type === 'cosmos:context') {
      applyContext(msg.context || {});
      try { window.dispatchEvent(new CustomEvent('cosmos:resize')); } catch (e) {}
    }
  });

  // Tell the parent we're alive.
  try { window.parent.postMessage({ type: 'cosmos:ready' }, '*'); } catch (e) {}
})();
</script>
`;
```

- [ ] **Step 2: Create Canvas.svelte**

Create `display/src/lib/widgets/Canvas.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { WidgetState, CanvasData, EntityState, SceneState } from '$lib/types';
  import { CANVAS_BRIDGE_SCRIPT } from './canvasBridge';

  export let widget: WidgetState;
  export let scene: SceneState;
  export let displayName: string;

  $: data = (widget.data as CanvasData | null) ?? { resolved: '', liveEntityIds: [] };
  $: content = data.resolved;

  let iframeEl: HTMLIFrameElement;
  let wrapperEl: HTMLDivElement;
  let resizeObs: ResizeObserver | null = null;
  let lastEntityById = new Map<string, EntityState>();
  let extraSubscribed = new Set<string>();

  function buildSrcdoc(html: string): string {
    return CANVAS_BRIDGE_SCRIPT + (html || '');
  }

  function context() {
    const w = wrapperEl?.clientWidth ?? 0;
    const h = wrapperEl?.clientHeight ?? 0;
    const fontFamily = (typeof document !== 'undefined'
      ? getComputedStyle(document.body).fontFamily
      : 'system-ui') || 'system-ui';
    const fontScale = Number(
      (typeof document !== 'undefined'
        ? getComputedStyle(document.body).getPropertyValue('--cosmos-font-scale')
        : '1') || '1',
    ) || 1;
    return {
      size: { w, h },
      scene: { id: scene.id, name: scene.name },
      font: { family: fontFamily, scale: fontScale },
    };
  }

  function postInit(entities: EntityState[]) {
    iframeEl?.contentWindow?.postMessage(
      { type: 'cosmos:init', context: context(), entities },
      '*',
    );
  }

  function postContext() {
    iframeEl?.contentWindow?.postMessage({ type: 'cosmos:context', context: context() }, '*');
  }

  function postState(entity: EntityState) {
    iframeEl?.contentWindow?.postMessage({ type: 'cosmos:state', entity }, '*');
  }

  // Receive `cosmos:ready` and `cosmos:want-entity` from the iframe.
  function onMessage(ev: MessageEvent) {
    if (ev.source !== iframeEl?.contentWindow) return;
    const msg = ev.data as { type?: string; entity_ids?: unknown };
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'cosmos:ready') {
      postInit(Array.from(lastEntityById.values()));
      return;
    }
    if (msg.type === 'cosmos:want-entity') {
      const ids = Array.isArray(msg.entity_ids)
        ? msg.entity_ids.filter((x): x is string => typeof x === 'string')
        : [];
      const fresh = ids.filter((id) => !extraSubscribed.has(id));
      if (fresh.length === 0) return;
      for (const id of fresh) extraSubscribed.add(id);
      // POST the request to the server. Errors are non-fatal.
      void fetch(`/api/canvases/${encodeURIComponent(widget.id)}/subscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, entity_ids: fresh }),
      }).catch(() => {});
    }
  }

  // Whenever liveEntityIds OR widget.data changes, push state to the iframe.
  // We rely on the parent receiving SceneState updates with the scene's
  // entity snapshot embedded in widget.data — for entities we don't yet
  // have, we fall back to per-id reads via a small server endpoint
  // (out-of-scope for v1; the bridge gracefully shows nothing until the
  // entity comes through liveEntityIds).
  $: if (data.liveEntityIds && iframeEl) {
    // No-op: entity state is forwarded via the scene push pipeline through
    // the parent component's broader state, see SceneCanvas wiring below.
    void data.liveEntityIds;
  }

  /** Forward a single entity update through to the iframe. Called from
   *  the reactive block in Task 8 when an entity in liveEntityIds changes. */
  function forwardEntity(entity: EntityState) {
    lastEntityById.set(entity.entity_id, entity);
    postState(entity);
  }

  onMount(() => {
    window.addEventListener('message', onMessage);
    resizeObs = new ResizeObserver(() => postContext());
    if (wrapperEl) resizeObs.observe(wrapperEl);
  });

  onDestroy(() => {
    window.removeEventListener('message', onMessage);
    resizeObs?.disconnect();
  });
</script>

<div class="canvas-wrap" bind:this={wrapperEl}>
  {#key content}
    <iframe
      bind:this={iframeEl}
      class="canvas-iframe"
      title="Cosmos canvas"
      sandbox="allow-scripts"
      srcdoc={buildSrcdoc(content)}
      referrerpolicy="no-referrer"
    ></iframe>
  {/key}
</div>

<style>
  .canvas-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: var(--cosmos-widget-radius, 0.75rem);
  }
  .canvas-iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    display: block;
  }
</style>
```

- [ ] **Step 3: Dispatch from SceneCanvas + forward entities**

In `display/src/lib/scene/SceneCanvas.svelte`:

```svelte
  import Canvas from '$lib/widgets/Canvas.svelte';
```

Find the `{#if w.kind === ...}` chain and add a case:

```svelte
        {:else if w.kind === 'canvas'}
          <Canvas widget={w} {scene} displayName={displayName ?? ''} />
```

Add a `displayName` prop near the existing exports:

```svelte
  export let displayName: string | null = null;
```

In `display/src/routes/+page.svelte`, where SceneCanvas (or TransitionStage) is mounted, pass through `displayName={name}`. If TransitionStage wraps SceneCanvas, plumb the prop through.

- [ ] **Step 4: Exempt canvas from the slot edge-fade mask**

In `display/src/lib/scene/WidgetSlot.svelte`, find the existing data-kind exemption block (currently the media-player exemption) and add canvas:

```css
  .widget-slot[data-kind='media_player'],
  .widget-slot[data-kind='canvas'] {
    -webkit-mask-image: none;
    mask-image: none;
  }
```

- [ ] **Step 5: Add the api.canvases.subscribe helper**

In `display/src/lib/admin/api.ts`, append (alongside other api groups):

```ts
  canvases: {
    async subscribe(widgetId: string, displayName: string, entityIds: string[]): Promise<void> {
      await fetch(`/api/canvases/${encodeURIComponent(widgetId)}/subscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, entity_ids: entityIds }),
      });
    },
  },
```

(Canvas.svelte uses fetch directly to keep the runtime path lean; this admin helper exists for any future tooling.)

- [ ] **Step 6: Build display**

Run: `npm --workspace display run build`
Expected: clean build; no type errors.

- [ ] **Step 7: Commit**

```bash
git add display/src/lib/widgets/canvasBridge.ts display/src/lib/widgets/Canvas.svelte display/src/lib/scene/SceneCanvas.svelte display/src/lib/scene/WidgetSlot.svelte display/src/lib/admin/api.ts display/src/routes/+page.svelte
git commit -m "feat(canvas): Canvas.svelte + sandboxed iframe bridge"
```

---

### Task 8: Forward entity updates from SceneCanvas to Canvas

The Canvas widget needs entity state pushed through the bridge whenever `liveEntityIds` change. The cleanest seam: SceneCanvas tracks the scene's entity set (from the resolved widget data of any `entity_tile`, `weather`, etc.) and forwards relevant ones to Canvas via its `forwardEntity` method, OR Canvas subscribes to a Svelte store of scene entities.

**Files:**
- Modify: `display/src/lib/scene/SceneCanvas.svelte`
- Modify: `display/src/lib/widgets/Canvas.svelte`

- [ ] **Step 1: Add an entitiesById prop on SceneCanvas**

In `display/src/lib/scene/SceneCanvas.svelte`, derive a single entity map from the scene's widget data:

```svelte
  $: entitiesById = (() => {
    const map = new Map<string, import('$lib/types').EntityState>();
    for (const w of scene.widgets) {
      const d = w.data as unknown;
      if (!d || typeof d !== 'object') continue;
      const e = d as { entity_id?: string; state?: string; attributes?: Record<string, unknown> };
      if (typeof e.entity_id === 'string' && typeof e.state === 'string') {
        map.set(e.entity_id, {
          entity_id: e.entity_id,
          state: e.state,
          attributes: (e.attributes ?? {}) as Record<string, unknown>,
        });
      }
    }
    return map;
  })();
```

Pass this to Canvas:

```svelte
        {:else if w.kind === 'canvas'}
          <Canvas widget={w} {scene} {entitiesById} displayName={displayName ?? ''} />
```

- [ ] **Step 2: React to entitiesById in Canvas**

In `display/src/lib/widgets/Canvas.svelte`, accept the prop and react:

```svelte
  export let entitiesById: Map<string, import('$lib/types').EntityState> = new Map();

  // Forward any liveEntityIds whose entity state changed since last tick.
  $: if (iframeEl && data.liveEntityIds) {
    for (const id of data.liveEntityIds) {
      const e = entitiesById.get(id);
      if (!e) continue;
      const prev = lastEntityById.get(id);
      if (!prev || prev.state !== e.state || JSON.stringify(prev.attributes) !== JSON.stringify(e.attributes)) {
        forwardEntity(e);
      }
    }
  }
```

- [ ] **Step 3: Build display**

Run: `npm --workspace display run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add display/src/lib/scene/SceneCanvas.svelte display/src/lib/widgets/Canvas.svelte
git commit -m "feat(canvas): forward entity state from scene to iframe"
```

---

### Task 9: Editor controls + examples

Adds the canvas-specific section to the scene editor: textarea, char counter, "How this works", "Insert example", "Open preview".

**Files:**
- Create: `display/src/lib/admin/canvasExamples.ts`
- Create: `display/src/lib/admin/canvas-help.md`
- Modify: `display/src/routes/admin/scenes/[id]/+page.svelte`

- [ ] **Step 1: Add `canvas` to the WIDGET_KINDS / labels lists**

In `display/src/routes/admin/scenes/[id]/+page.svelte`:

```ts
  const WIDGET_KINDS: WidgetKind[] = ['clock', 'weather', 'entity_tile', 'calendar', 'media_player', 'statistics', 'text', 'camera', 'canvas'];

  const WIDGET_KIND_LABELS: Record<WidgetKind, string> = {
    clock: 'Clock',
    weather: 'Weather',
    entity_tile: 'Entity tile',
    calendar: 'Calendar agenda',
    media_player: 'Media player',
    statistics: 'Statistics / history',
    text: 'Text',
    camera: 'Camera',
    canvas: 'Canvas (HTML/JS)',
  };
```

- [ ] **Step 2: Default canvas content on widget kind switch**

In `setWidgetKind()`, after the existing branches:

```ts
    if (kind === 'canvas') {
      w.config = {
        content: '<div style="display:grid;place-items:center;width:100%;height:100%;font-family:system-ui;color:#f5f5f5">\n  <div>Hello, canvas!</div>\n</div>',
      };
    }
```

- [ ] **Step 3: Create the examples module**

Create `display/src/lib/admin/canvasExamples.ts`:

```ts
export type CanvasExample = { id: string; label: string; description: string; content: string };

export const CANVAS_EXAMPLES: CanvasExample[] = [
  {
    id: 'hello',
    label: 'Hello world',
    description: 'Static text + a live read of the canvas size.',
    content: `<div style="display:grid;place-items:center;width:100%;height:100%;font-family:system-ui;color:#f5f5f5">
  <div>
    <h1 style="margin:0;font-weight:300">Hello, canvas!</h1>
    <p id="size" style="margin:0.5rem 0 0;opacity:0.6"></p>
  </div>
</div>
<script>
  cosmos.ready.then(() => {
    document.getElementById('size').textContent = cosmos.size.w + ' × ' + cosmos.size.h + ' px';
  });
  window.addEventListener('cosmos:resize', () => {
    document.getElementById('size').textContent = cosmos.size.w + ' × ' + cosmos.size.h + ' px';
  });
</script>`,
  },
  {
    id: 'entity-card',
    label: 'Templated entity card',
    description: 'One Jinja template + a styled box. No JS.',
    content: `<div style="padding:1.5rem;font-family:system-ui;color:#f5f5f5">
  <div style="opacity:0.6;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em">Power</div>
  <div style="font-size:3rem;font-weight:200;line-height:1.1">{{ states("sensor.power") }} W</div>
  <div style="opacity:0.6;font-size:0.85rem">last updated {{ relative_time(states.sensor.power.last_changed) }}</div>
</div>`,
  },
  {
    id: 'live-gauge',
    label: 'Live gauge',
    description: 'Subscribe to a sensor and animate an SVG arc.',
    content: `<div style="display:grid;place-items:center;width:100%;height:100%">
  <svg viewBox="0 0 100 60" width="80%" style="overflow:visible">
    <path d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="6" stroke-linecap="round"/>
    <path id="fill" d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-dasharray="0 200"/>
    <text id="lbl" x="50" y="50" text-anchor="middle" fill="#fff" font-family="system-ui" font-size="12">—</text>
  </svg>
</div>
<script>
  cosmos.subscribe('sensor.power', (e) => {
    const v = Math.max(0, Math.min(2000, Number(e.state) || 0));
    const pct = v / 2000;
    document.getElementById('fill').setAttribute('stroke-dasharray', (pct * 126) + ' 200');
    document.getElementById('lbl').textContent = Math.round(v) + ' W';
  });
</script>`,
  },
  {
    id: 'recipe',
    label: 'Recipe card',
    description: 'Static HTML — no templates, no JS.',
    content: `<div style="display:grid;grid-template-rows:auto 1fr;width:100%;height:100%;font-family:system-ui;color:#f5f5f5;padding:1rem">
  <h2 style="margin:0;font-weight:300">Tonight: shakshuka</h2>
  <ol style="margin:0.5rem 0 0;padding-left:1.25rem;line-height:1.5;opacity:0.85">
    <li>Sauté onion + pepper in olive oil 8 min</li>
    <li>Add garlic, cumin, paprika; stir 30s</li>
    <li>Pour in crushed tomatoes; simmer 15 min</li>
    <li>Crack 4 eggs into wells; cover 6 min</li>
    <li>Top with feta and parsley; serve with bread</li>
  </ol>
</div>`,
  },
  {
    id: 'sun-palette',
    label: 'Sun-driven palette',
    description: 'Subscribes to sun.sun and swaps CSS variables to match dawn/day/dusk/night.',
    content: `<div id="root" style="--bg:#1a1a2e;--fg:#f5f5f5;background:var(--bg);color:var(--fg);width:100%;height:100%;display:grid;place-items:center;transition:background 1s,color 1s;font-family:system-ui">
  <div style="text-align:center">
    <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.15em;opacity:0.6">Sun phase</div>
    <div id="phase" style="font-size:2rem;font-weight:300">—</div>
  </div>
</div>
<script>
  function paint(state) {
    const root = document.getElementById('root');
    if (state === 'above_horizon') {
      root.style.setProperty('--bg', '#fcb69f');
      root.style.setProperty('--fg', '#3a1c00');
      document.getElementById('phase').textContent = 'Day';
    } else {
      root.style.setProperty('--bg', '#1a1a2e');
      root.style.setProperty('--fg', '#bfe9ff');
      document.getElementById('phase').textContent = 'Night';
    }
  }
  cosmos.subscribe('sun.sun', (e) => paint(e.state));
</script>`,
  },
];
```

- [ ] **Step 4: Create the in-product help markdown**

Create `display/src/lib/admin/canvas-help.md`:

````markdown
# How the canvas widget works

A canvas widget renders any HTML/CSS/JS you (or an LLM agent) write inside a sandboxed iframe filling the widget's grid cell.

## Templates

Wrap any expression in `{{ ... }}` to have Home Assistant render it server-side using its **standard template engine**. Anything that works in an HA automation works here:

```html
<h1>{{ states("sensor.power") }} W</h1>
<p>last seen {{ relative_time(states.binary_sensor.front_door.last_changed) }}</p>
```

## The `cosmos` API

Inside the iframe, `window.cosmos` exposes:

| Member | Purpose |
|---|---|
| `cosmos.ready` | A promise that resolves when the bridge has handshook with the parent. |
| `cosmos.size = { w, h }` | The cell's pixel dimensions. Updates on resize; listen with `window.addEventListener('cosmos:resize', ...)`. |
| `cosmos.scene = { id, name }` | Scene metadata. |
| `cosmos.font = { family, scale }` | The scene's chosen typography. |
| `cosmos.entity('sensor.foo')` | Returns the cached `EntityState` or `null`. |
| `cosmos.subscribe('sensor.foo', cb)` | Calls `cb(entity)` on every state change. Returns an `unsubscribe()`. |

The API is **read-only**. Service calls are not yet supported.

## Sandbox

The iframe runs with `sandbox="allow-scripts"`. That means:

- No same-origin access (no parent storage, no top-frame navigation).
- No forms, popups, or pointer-lock.
- Cross-origin font loading via `@font-face` will fail. Use system fonts (the parent passes a usable family in `cosmos.font.family`) or embed your font as a data URL.

## One canvas per scene

Tablets running 24/7 with multiple sandboxed iframes pay a real memory + decode cost. The editor lets you place more than one, but the recommendation is **one canvas per scene**.
````

- [ ] **Step 5: Add the canvas editor section**

In `display/src/routes/admin/scenes/[id]/+page.svelte`, in the per-widget switch (after the existing branches like `text`):

```svelte
          {:else if w.kind === 'canvas'}
            <Field label="Content (HTML / CSS / JS)">
              <div class="canvas-editor-toolbar">
                <button type="button" class="ghost" on:click={() => helpOpen[i] = !helpOpen[i]}>
                  ⓘ How this works
                </button>
                <select on:change={(e) => insertCanvasExample(i, e.currentTarget.value); e.currentTarget.value = ''}>
                  <option value="">📋 Insert example…</option>
                  {#each CANVAS_EXAMPLES as ex (ex.id)}<option value={ex.id}>{ex.label}</option>{/each}
                </select>
                <button type="button" class="ghost" on:click={() => openCanvasPreview(w.id)}>🚀 Open preview</button>
              </div>
              {#if helpOpen[i]}
                <div class="canvas-help">{@html canvasHelpHtml}</div>
              {/if}
              <textarea
                rows="14"
                class="canvas-content"
                placeholder="Type or paste HTML/CSS/JS. Use {{ states('sensor.foo') }} for live values."
                value={configStr(w.config, 'content')}
                on:input={(e) => { w.config = { ...w.config, content: e.currentTarget.value }; widgets = widgets; }}
                on:keydown={canvasTabHandler}
              ></textarea>
              <span class="hint">{configStr(w.config, 'content').length.toLocaleString()} chars · soft limit ~50,000.</span>
            </Field>
```

In the `<script>` block of the same file, add the helpers:

```ts
  import { CANVAS_EXAMPLES } from '$lib/admin/canvasExamples';
  // Vite imports raw markdown as a string with the `?raw` suffix.
  import canvasHelpRaw from '$lib/admin/canvas-help.md?raw';
  // Tiny markdown → HTML pass: just paragraph + heading + code block + table.
  // Keeping it dependency-free; if you need full markdown later swap in
  // `marked` or similar.
  const canvasHelpHtml = canvasHelpRaw
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/```([\s\S]*?)```/g, (_, body) => `<pre><code>${body.trim().replace(/</g, '&lt;')}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\| (.+) \|$/gm, (line) => '<tr>' + line.slice(2, -2).split(' | ').map((c) => `<td>${c}</td>`).join('') + '</tr>')
    .replace(/(\n<tr>.*<\/tr>)+/gs, (block) => `<table>${block}</table>`);

  let helpOpen: Record<number, boolean> = {};

  function insertCanvasExample(idx: number, exampleId: string) {
    const ex = CANVAS_EXAMPLES.find((e) => e.id === exampleId);
    if (!ex) return;
    const current = (widgets[idx].config as { content?: string }).content ?? '';
    if (current.trim() && !confirm('Replace current canvas content with the example?')) return;
    widgets[idx].config = { ...widgets[idx].config, content: ex.content };
    widgets = widgets;
  }

  function openCanvasPreview(widgetId: string) {
    window.open(`/preview-canvas?id=${encodeURIComponent(widgetId)}`, `cosmos-canvas-${widgetId}`, 'width=720,height=480,noopener');
  }

  function canvasTabHandler(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = e.currentTarget as HTMLTextAreaElement;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const v = ta.value;
    ta.value = v.slice(0, start) + '\t' + v.slice(end);
    ta.selectionStart = ta.selectionEnd = start + 1;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
```

- [ ] **Step 6: Add CSS at the bottom of the same file**

```css
  .canvas-editor-toolbar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  textarea.canvas-content {
    width: 100%;
    min-height: 14rem;
    max-height: 40rem;
    resize: vertical;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.5;
    tab-size: 2;
  }
  .canvas-help {
    background: #0e0e0e;
    border: 1px solid #2a2a2a;
    border-radius: 0.5rem;
    padding: 0.85rem 1rem;
    margin-bottom: 0.5rem;
    color: #ccc;
    font-size: 0.88rem;
    line-height: 1.55;
  }
  .canvas-help h1 { font-size: 1.05rem; margin: 0.25rem 0 0.4rem; }
  .canvas-help h2 { font-size: 0.95rem; margin: 0.6rem 0 0.3rem; color: #e5e5e5; }
  .canvas-help h3 { font-size: 0.88rem; margin: 0.5rem 0 0.25rem; color: #ddd; }
  .canvas-help table { width: 100%; border-collapse: collapse; margin: 0.4rem 0; font-size: 0.82rem; }
  .canvas-help td { padding: 0.2rem 0.4rem; border-bottom: 1px solid #2a2a2a; vertical-align: top; }
  .canvas-help code, .canvas-help pre {
    background: #1a1a1a;
    padding: 0.05rem 0.3rem;
    border-radius: 0.25rem;
    font-family: ui-monospace, monospace;
  }
  .canvas-help pre { padding: 0.6rem 0.85rem; overflow-x: auto; }
```

- [ ] **Step 7: Build display**

Run: `npm --workspace display run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add display/src/lib/admin/canvasExamples.ts display/src/lib/admin/canvas-help.md display/src/routes/admin/scenes/[id]/+page.svelte
git commit -m "feat(canvas): editor controls, help panel, examples dropdown"
```

---

### Task 10: Standalone preview route

A new route `/preview-canvas?id=<widgetId>` that fetches the widget's content from the active scene (admin-side, not iframe-sandboxed) and renders just the Canvas widget at viewport size for iterating.

**Files:**
- Create: `display/src/routes/preview-canvas/+page.svelte`

- [ ] **Step 1: Implement the preview page**

Create `display/src/routes/preview-canvas/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/admin/api';
  import Canvas from '$lib/widgets/Canvas.svelte';
  import type { WidgetState, SceneState } from '$lib/types';

  let widget: WidgetState | null = null;
  let scene: SceneState | null = null;

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return;
    const all = await api.scenes.list();
    for (const s of all) {
      const found = (s.widgets ?? []).find((w: WidgetState) => w.id === id);
      if (found) {
        widget = found;
        scene = s as unknown as SceneState;
        return;
      }
    }
  });
</script>

<svelte:head><title>Cosmos — Canvas preview</title></svelte:head>

<main style="position:fixed;inset:0;background:#0a0a0a">
  {#if widget && scene}
    <Canvas {widget} {scene} displayName="preview" entitiesById={new Map()} />
  {:else}
    <div style="display:grid;place-items:center;width:100%;height:100%;color:#888;font-family:system-ui">
      Loading…
    </div>
  {/if}
</main>
```

- [ ] **Step 2: Build display**

Run: `npm --workspace display run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add display/src/routes/preview-canvas/+page.svelte
git commit -m "feat(canvas): standalone preview route"
```

---

### Task 11: Documentation

Three docs land here. Each is verbatim — no placeholders.

**Files:**
- Create: `docs/canvas-widget.md`
- Create: `docs/canvas-widget-agent.md`
- Modify: `CLAUDE.md`
- Modify: `server/CLAUDE.md`
- Modify: `display/CLAUDE.md`
- Modify: `addon/DOCS.md`

- [ ] **Step 1: Write the user guide**

Create `docs/canvas-widget.md` with the full text below. Treat the contents as canonical; do not paraphrase.

````markdown
# Cosmos canvas widget

The canvas widget is a sandboxed iframe living inside a single grid cell of your scene. Inside it, you (or an LLM agent) can write any HTML / CSS / JavaScript and bind it to live Home Assistant data using HA's own template engine.

It's the most powerful widget in Cosmos and the only one with a real attack surface; this guide is comprehensive on both ends.

## Quick start

1. Open the scene editor, click **+ Add widget**, switch the kind to **Canvas (HTML/JS)**.
2. Paste this into the content textarea:

```html
<div style="display:grid;place-items:center;width:100%;height:100%;font-family:system-ui;color:#f5f5f5">
  <div>
    <div style="opacity:0.6;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em">Power</div>
    <div style="font-size:3rem;font-weight:200">{{ states("sensor.power") }} W</div>
  </div>
</div>
```

3. Save. The widget renders the value live; when `sensor.power` changes, the displayed number updates within ~100ms.

## Templates: pin-for-pin compatible with HA

Anything inside `{{ ... }}` is rendered by Home Assistant's own Jinja engine. That means:

- Every function and filter that works in an HA automation template works here.
- Cosmos auto-subscribes to the entities your template depends on; no manual wiring needed.
- Errors come back from HA verbatim and render in place of the template (e.g. `TemplateSyntaxError: unexpected '%'`).

Common patterns:

```jinja
{{ states("sensor.kitchen_temp") }}                      → "21.5"
{{ state_attr("weather.home", "humidity") }}             → 64
{{ is_state("binary_sensor.front_door", "on") }}         → True / False
{{ relative_time(states.sensor.power.last_changed) }}    → "5 minutes ago"
{% if is_state("sun.sun", "above_horizon") %}Day{% else %}Night{% endif %}
```

Full template grammar reference: <https://www.home-assistant.io/docs/configuration/templating/>.

## The `cosmos` JS API

Inside the iframe, `window.cosmos` exposes a small read-only API.

| Member | Type | Description |
|---|---|---|
| `cosmos.ready` | `Promise<void>` | Resolves once the bridge has received the parent's initial state push. |
| `cosmos.size` | `{ w: number; h: number }` | Pixel dimensions of the iframe. Updates on resize; subscribe via `window.addEventListener('cosmos:resize', ...)`. |
| `cosmos.scene` | `{ id: string; name: string }` | Scene metadata. |
| `cosmos.font` | `{ family: string; scale: number }` | Inherited typography. The iframe is cross-origin and can't load Cosmos's bundled fonts via `@font-face`, but `family` will name a system-available fallback. |
| `cosmos.version` | `string` | Bridge protocol version. |
| `cosmos.entity(id)` | `(id: string) => EntityState \| null` | One-shot read of a cached entity. Returns null if the entity isn't being tracked yet. |
| `cosmos.subscribe(id, cb)` | `(id: string, cb: (e: EntityState) => void) => () => void` | Calls `cb(entity)` on every state change. The first call also seeds `cb` with the current value if known. Returns an unsubscribe. Subscribing to an entity not already in your templates triggers a server-side subscription request automatically. |

The API is intentionally read-only in v1. Calling HA services from inside the iframe is on the v2 list, gated behind an explicit "allow service calls" toggle.

## Sandbox

The iframe runs with `sandbox="allow-scripts"`. The browser enforces:

- **Origin is `null`** — no access to parent storage or cookies, no same-origin fetches, no top-level navigation.
- **No forms, popups, plugins, pointer-lock, or modals.**
- **Cross-origin `@font-face` loading fails** — use system fonts (Cosmos passes a sensible `cosmos.font.family`) or embed fonts as data URLs.
- **Network requests** can still happen via `fetch()`, but only to public URLs that allow CORS. Same-origin (Cosmos's API) is blocked by the null origin.

If you find yourself wanting to break out of these constraints, you almost certainly want a different widget kind — entity tile, statistics, or media player.

## One canvas per scene (recommendation)

Wall tablets run 24/7. Each iframe carries its own JS engine instance, layout tree, paint pipeline, and any animation loops you start. Two heavy canvases on the same scene measurably hurt frame rate and memory headroom on a Raspberry Pi tablet.

The editor doesn't enforce a single canvas — there are legitimate cases (a quick toggle next to a stats panel) — but the default assumption in performance budgets is one.

## Authoring tips

- **Size to 100%, not pixels.** Every canvas should fit any cell:
  ```html
  <div style="width:100%;height:100%;display:grid;place-items:center">…</div>
  ```
- **Listen for resize.** If your layout depends on `cosmos.size`, recompute on `cosmos:resize`:
  ```js
  window.addEventListener('cosmos:resize', layout);
  ```
- **Prefer SVG over Canvas.** SVG re-flows for free; `<canvas>` requires manual repaint.
- **Avoid hot animation loops.** A tablet rendering a 60fps `requestAnimationFrame` loop will eat battery and CPU. Use CSS animations / transitions whenever possible.
- **Match the scene typography.** Apply `cosmos.font.family` to your root element so the canvas matches the surrounding scene.
- **Keep it small.** The editor warns past 50KB. Larger payloads work but ship slower over WS and re-parse on every content change.

## Worked examples

The "Insert example" dropdown in the editor seeds five starters:

1. **Hello world** — static text + a `cosmos.size` readout. The "did the bridge work?" smoke test.
2. **Templated entity card** — one Jinja template + a styled box. No JS. Demonstrates the most common shape.
3. **Live gauge** — subscribes to a sensor, animates an SVG arc. The minimum viable JS canvas.
4. **Recipe card** — pure static HTML, no templates, no JS. Useful for ambient information.
5. **Sun-driven palette** — subscribes to `sun.sun` and swaps CSS variables to repaint the canvas at sunrise/sunset.

Each example is a self-contained ~30–60 line snippet you can copy, modify, and ship.

## Troubleshooting

**My template renders as `{{ states(...) }}` literally.**
Cosmos isn't connected to HA, or the template engine isn't initialised yet. Check the addon log for `Home Assistant connected` near startup. In dev mode (no HA), templates always pass through unrendered.

**My fetch() returns CORS errors.**
The iframe origin is `null`; only public CORS-permissive URLs work. Cosmos's own API isn't reachable from inside the canvas (and shouldn't be — that's the security boundary).

**My font doesn't load.**
Cross-origin `@font-face` fails because of the null origin. Use system fonts via `cosmos.font.family`, or inline the font as a base64 data URL inside `@font-face`.

**Updates don't arrive.**
Confirm the entity id is exactly what HA reports (case-sensitive). Use `cosmos.entity('sensor.foo')` from the iframe console to verify. If it returns null, the parent hasn't pushed it yet — check that the entity exists in HA Developer Tools.

**The whole iframe is blank.**
Open browser devtools, navigate the iframe context, check the console. Unhandled errors in your `<script>` block silently abort the rest. Wrap in try/catch during development.
````

- [ ] **Step 2: Write the agent guide**

Create `docs/canvas-widget-agent.md`:

````markdown
# Canvas widget — agent contract

This document is intended to be pasted into an LLM agent's system prompt or pulled in as a tool/reference document. It describes exactly what the agent should output when generating canvas widget content for Cosmos.

## Contract

You are emitting a complete HTML body for a Cosmos canvas widget. Output ONLY the HTML; no markdown fences, no preamble, no closing chatter. The output should be ready to drop into the widget's `content` field.

Example completion:

```html
<div style="display:grid;place-items:center;width:100%;height:100%;font-family:system-ui;color:#f5f5f5">
  <div>{{ states("sensor.power") }} W</div>
</div>
```

Do **not** wrap the output in `<html>` or `<body>` tags — your output is concatenated with a Cosmos-injected bridge script and inserted into an iframe `srcdoc`.

## What's available

### Templates (server-side, evaluated by HA)

Wrap any expression in `{{ ... }}`. Standard Home Assistant Jinja:

- `states("entity_id")` — current state as string
- `state_attr("entity_id", "attr")` — attribute value (any type)
- `is_state("entity_id", "value")` — boolean
- `relative_time(states.X.last_changed)` — humanised duration
- `now()`, `as_timestamp(...)`, `today_at(...)` — time helpers
- `{% if %}`, `{% for %}` — full control flow

Cosmos automatically subscribes to entities your templates touch and re-renders the canvas when they change.

### JS API (in-iframe, exposed as `window.cosmos`)

```ts
cosmos.ready: Promise<void>
cosmos.size: { w: number; h: number }
cosmos.scene: { id: string; name: string }
cosmos.font: { family: string; scale: number }
cosmos.version: string

cosmos.entity(id: string): EntityState | null
cosmos.subscribe(id: string, cb: (e: EntityState) => void): () => void

type EntityState = { entity_id: string; state: string; attributes: Record<string, unknown> }
```

Subscribe is the live binding; reach for it when an animation needs to react to state.

### Resize event

`window.addEventListener('cosmos:resize', () => recompute())` fires when `cosmos.size` changes.

## What's forbidden

- `<script src="https://...">` — cross-origin scripts won't load. Inline scripts only.
- `fetch()` to Cosmos's API or to HA — origin is `null`; same-origin requests are blocked. Public CORS-permissive URLs work.
- Service calls — there is no `cosmos.callService`. The agent cannot turn lights on/off; describe state, do not mutate it.
- Top-frame navigation, popups, forms, pointer-lock — sandboxed away by the browser.
- `@font-face` loading from cross-origin URLs — embed fonts as data URLs if you must.

## Style hints

- Always size your root to `width: 100%; height: 100%`. The canvas fills its grid cell, which is variable.
- Use `cosmos.font.family` so the canvas blends with the surrounding scene typography.
- Prefer light, airy layouts. Cosmos kiosk surfaces are usually viewed from across a room.
- Pure-CSS animations beat JS animations. Use `requestAnimationFrame` only when CSS can't express the effect.
- Keep total document under 50,000 characters. Larger payloads slow scene pushes.

## Completion shapes

### "Number card" — show one HA value with a label

```html
<div style="padding:1.5rem;font-family:system-ui;color:#f5f5f5">
  <div style="opacity:0.6;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em">{LABEL}</div>
  <div style="font-size:3rem;font-weight:200;line-height:1.1">{{ states("{ENTITY}") }} {UNIT}</div>
</div>
```

### "Live gauge" — animated SVG bound to a sensor

```html
<div style="display:grid;place-items:center;width:100%;height:100%">
  <svg viewBox="0 0 100 60" width="80%">
    <path d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="6"/>
    <path id="fill" d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="0 200"/>
    <text id="lbl" x="50" y="50" text-anchor="middle" fill="#fff" font-size="12">—</text>
  </svg>
</div>
<script>
  cosmos.subscribe('{ENTITY}', (e) => {
    const v = Number(e.state) || 0;
    const pct = Math.min(1, v / {MAX});
    document.getElementById('fill').setAttribute('stroke-dasharray', (pct * 126) + ' 200');
    document.getElementById('lbl').textContent = Math.round(v) + ' {UNIT}';
  });
</script>
```

### "Static info card" — fixed content, no templates, no JS

```html
<div style="padding:1rem;font-family:system-ui;color:#f5f5f5">
  <h2 style="margin:0;font-weight:300">{TITLE}</h2>
  <p style="margin:0.5rem 0 0;opacity:0.85;line-height:1.5">{BODY}</p>
</div>
```

Replace `{ENTITY}`, `{LABEL}`, `{UNIT}`, `{MAX}`, `{TITLE}`, `{BODY}` with values from the user's intent.
````

- [ ] **Step 3: Update the root CLAUDE.md**

Append to `CLAUDE.md` under the appropriate section (the "## Architecture" or similar where existing widgets are listed):

```markdown
- `canvas` widget — sandboxed iframe (`sandbox="allow-scripts"`) running user/agent-authored HTML/CSS/JS. Templates inside the content (`{{ states("...") }}`) are rendered server-side by HA via the `render_template` WS subscription (pin-for-pin HA-compatible). The iframe gets a small read-only postMessage bridge exposing `window.cosmos.{entity, subscribe, size, scene, font, ready}`. See `docs/canvas-widget.md` (user) and `docs/canvas-widget-agent.md` (LLM contract).
```

- [ ] **Step 4: Update server/CLAUDE.md**

Append:

```markdown
- `src/ha/templates.ts` — TemplatesClient. Wraps HA's `render_template` WS subscription with ref-counted sharing across callers and error pass-through.
- `src/scenes/canvas.ts` — `createCanvasResolver` bridges the assembler to TemplatesClient, tracking per-widget cleanups so re-resolves drop the previous subscription.
- `src/api/canvases.ts` — `POST /api/canvases/:widgetId/subscribe` records iframe-side entity-id requests in a per-(display, widget) extras store. Cleared on display disconnect.
```

- [ ] **Step 5: Update display/CLAUDE.md**

Append:

```markdown
- `src/lib/widgets/Canvas.svelte` — sandboxed iframe widget. Mounts with `sandbox="allow-scripts"`, srcdoc = bridge script + resolved content. Forwards entity-state changes from SceneCanvas to the iframe via `postMessage`. Re-mounts only on `widget.config.content` change (`{#key content}`); state-only updates flow as messages.
- `src/lib/widgets/canvasBridge.ts` — the bridge script as a const string, injected into every canvas iframe.
- `src/lib/admin/canvasExamples.ts` + `canvas-help.md` — editor's Insert-example dropdown content + How-this-works panel source.
- `src/routes/preview-canvas/+page.svelte` — standalone full-window preview at `/preview-canvas?id=<widgetId>` for canvas authors iterating without scene chrome.
```

- [ ] **Step 6: Update addon/DOCS.md**

Append a new section:

```markdown
## Canvas widget

The canvas widget runs sandboxed HTML/CSS/JS authored by you or an LLM agent. Templates inside the content (`{{ states("sensor.foo") }}`) are rendered by Home Assistant — full HA Jinja compatibility. The iframe gets a read-only `cosmos` JS bridge for live entity subscriptions.

See [`docs/canvas-widget.md`](https://github.com/qrobinso/cosmos-ha-dashboard/blob/main/docs/canvas-widget.md) for the full guide and [`docs/canvas-widget-agent.md`](https://github.com/qrobinso/cosmos-ha-dashboard/blob/main/docs/canvas-widget-agent.md) for the agent contract.

Recommended: one canvas per scene. Multiple sandboxed iframes on a tablet running 24/7 are measurably expensive on memory + CPU.
```

- [ ] **Step 7: Commit**

```bash
git add docs/canvas-widget.md docs/canvas-widget-agent.md CLAUDE.md server/CLAUDE.md display/CLAUDE.md addon/DOCS.md
git commit -m "docs(canvas): user guide, agent contract, CLAUDE.md updates"
```

---

### Task 12: Bump addon version + smoke build

Last touch — bump the addon version and confirm everything still builds + tests green.

**Files:**
- Modify: `addon/config.yaml`

- [ ] **Step 1: Bump version**

In `addon/config.yaml`, increment the `version:` field. The previous landed value was `0.1.26`; this plan ships as `0.2.0` (minor bump because canvas is a notable user-visible feature).

```yaml
version: "0.2.0"
```

- [ ] **Step 2: Full build + tests**

Run:
```bash
npm --workspace server run build && npm --workspace server test
npm --workspace display run build
```

Expected: all green.

- [ ] **Step 3: Commit + push**

```bash
git add addon/config.yaml
git commit -m "chore(addon): bump to 0.2.0 — canvas widget"
git push -u origin cosmos-canvas-widget
```

The push opens the standard PR target on GitHub for review/merge.

---

## Verification checklist

After all tasks are complete, manually verify:

- [ ] Edit a scene, add a Canvas widget, paste the "Hello world" example, save. The kiosk shows the size readout updating on resize.
- [ ] Switch to "Templated entity card" example with `sensor.power` (or any HA sensor). The number renders correctly.
- [ ] In HA Developer Tools, change the value of that sensor. Within ~1s the canvas updates without scene reload.
- [ ] Try a malformed template like `{{ states.notathing.foo.bar }}` — the iframe shows the error string in place of the template.
- [ ] Open `/preview-canvas?id=<widgetId>` in a separate window — the canvas renders full-viewport.
- [ ] Confirm the "How this works" panel renders the markdown legibly.
- [ ] Confirm the bridge enforces sandboxing: try `<script>fetch('/api/scenes')</script>` inside a canvas; it should fail with a CORS error visible in the iframe console.
