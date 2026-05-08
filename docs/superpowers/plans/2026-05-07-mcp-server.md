# MCP server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MCP HTTP server to Cosmos at `/mcp` so external agents (Claude Desktop, Cursor, etc.) can list/inspect/edit scenes and widgets via the Model Context Protocol, gated behind a bearer token in Settings.

**Architecture:** Mount `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` on the existing Fastify instance. The MCP server exposes 11 tools (the in-product agent's auto-execute set, no destructive actions) plus 3 resources (the two agent contracts + live HA entity catalog). Tools' `execute` calls reuse `app.inject(...)` against the existing REST endpoints — same validation + display-notification path as the in-product agent.

**Tech Stack:** `@modelcontextprotocol/sdk@^1.29` + existing Fastify 4 / zod 3 / Node 20. Spec: `docs/superpowers/specs/2026-05-07-mcp-server-design.md`.

---

## File map

| Path | Created/Modified | Purpose |
|---|---|---|
| `server/package.json` | M | Add `@modelcontextprotocol/sdk` dependency |
| `server/src/store/mcp-token.ts` | C | Token helpers: `getToken`, `regenerateToken`, `clearToken`, `isEnabled`, `setEnabled` |
| `server/src/mcp/tools.ts` | C | 11 MCP tool definitions; each `execute` calls `app.inject(...)` |
| `server/src/mcp/resources.ts` | C | 3 resource handlers: 2 doc files + live entity catalog |
| `server/src/mcp/server.ts` | C | Build the SDK `McpServer`, register tools + resources |
| `server/src/api/mcp.ts` | C | Fastify routes: `/mcp` transport + `/api/agent/mcp/*` settings endpoints + auth gate |
| `server/src/api/http.ts` | M | Wire `registerMcpRoutes(app, deps)` |
| `server/test/mcp-token.test.ts` | C | Unit tests for the token store |
| `server/test/mcp-server.test.ts` | C | Integration tests: auth, tools/list, tool round-trip, resources |
| `display/src/lib/admin/api.ts` | M | `agent.getMcpConfig()`, `agent.enableMcp()`, `agent.regenerateMcpToken()` |
| `display/src/routes/admin/settings/+page.svelte` | M | New "Agent-to-agent (MCP)" card |
| `addon/config.yaml` | M | Bump to `0.5.0` |
| `addon/CHANGELOG.md` | M | New entry for MCP server |

---

## Task 1: Install MCP SDK

**Files:**
- Modify: `server/package.json` (via `npm install`)

- [ ] **Step 1: Install the SDK pinned to ^1.29**

Run from repo root:

```bash
npm --workspace server install @modelcontextprotocol/sdk@^1.29
```

- [ ] **Step 2: Confirm it's resolvable**

Run:

```bash
node -e "require.resolve('@modelcontextprotocol/sdk/server/mcp.js')"
echo "ok"
```

Expected: prints `ok` with no error.

- [ ] **Step 3: Confirm server typecheck still passes**

Run:

```bash
npm --workspace server run build
```

Expected: clean exit (no TS errors). The new dep doesn't change any imports yet.

- [ ] **Step 4: Confirm tests still pass**

Run:

```bash
npm --workspace server test
```

Expected: 210 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/package.json package-lock.json
git commit -m "chore(deps): add @modelcontextprotocol/sdk for MCP server"
```

---

## Task 2: Token store

The MCP token + enabled flag are wrapped in a tiny module so callers don't have to know the settings keys. Pure function over the existing `SettingsRepo`.

**Files:**
- Create: `server/src/store/mcp-token.ts`
- Test: `server/test/mcp-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/mcp-token.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createSettingsRepo } from '../src/store/settings.js';
import {
  getToken,
  regenerateToken,
  clearToken,
  isEnabled,
  setEnabled,
} from '../src/store/mcp-token.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return createSettingsRepo(db);
}

describe('mcp-token store', () => {
  let settings: ReturnType<typeof createSettingsRepo>;

  beforeEach(() => {
    settings = setup();
  });

  it('isEnabled defaults to false', () => {
    expect(isEnabled(settings)).toBe(false);
  });

  it('setEnabled(true) flips the flag and back', () => {
    setEnabled(settings, true);
    expect(isEnabled(settings)).toBe(true);
    setEnabled(settings, false);
    expect(isEnabled(settings)).toBe(false);
  });

  it('getToken returns null until regenerated', () => {
    expect(getToken(settings)).toBeNull();
  });

  it('regenerateToken produces a cosmos_mcp_-prefixed hex string and persists it', () => {
    const t1 = regenerateToken(settings);
    expect(t1).toMatch(/^cosmos_mcp_[0-9a-f]{64}$/);
    expect(getToken(settings)).toBe(t1);
  });

  it('regenerateToken called twice yields a different value', () => {
    const t1 = regenerateToken(settings);
    const t2 = regenerateToken(settings);
    expect(t1).not.toBe(t2);
    expect(getToken(settings)).toBe(t2);
  });

  it('clearToken removes the token but leaves the enabled flag', () => {
    regenerateToken(settings);
    setEnabled(settings, true);
    clearToken(settings);
    expect(getToken(settings)).toBeNull();
    expect(isEnabled(settings)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm --workspace server test -- mcp-token
```

Expected: FAIL with "Cannot find module '../src/store/mcp-token.js'".

- [ ] **Step 3: Implement the store**

Create `server/src/store/mcp-token.ts`:

```typescript
import { randomBytes } from 'node:crypto';
import type { SettingsRepo } from './settings.js';

const KEY_TOKEN = 'mcp_token';
const KEY_ENABLED = 'mcp_enabled';

/** Returns the current MCP bearer token, or null when none is set. */
export function getToken(settings: SettingsRepo): string | null {
  const v = settings.get(KEY_TOKEN);
  return v && v.length > 0 ? v : null;
}

/** Generates a fresh token and persists it. Returns the new value so the
 *  caller can echo it back to the user once. The old token is gone. */
export function regenerateToken(settings: SettingsRepo): string {
  const hex = randomBytes(32).toString('hex');
  const token = `cosmos_mcp_${hex}`;
  settings.set(KEY_TOKEN, token);
  return token;
}

/** Wipes the token. Used by the explicit Clear action; not by the toggle. */
export function clearToken(settings: SettingsRepo): void {
  settings.set(KEY_TOKEN, '');
}

/** Whether the user has flipped the MCP toggle on. Independent of token. */
export function isEnabled(settings: SettingsRepo): boolean {
  return settings.get(KEY_ENABLED) === 'true';
}

/** Set or clear the enabled flag. */
export function setEnabled(settings: SettingsRepo, enabled: boolean): void {
  settings.set(KEY_ENABLED, enabled ? 'true' : '');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm --workspace server test -- mcp-token
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/store/mcp-token.ts server/test/mcp-token.test.ts
git commit -m "feat(mcp): token store (get/regenerate/clear/enabled)"
```

---

## Task 3: MCP tools — definition file + first integration smoke

This task lays down `mcp/tools.ts` with all 11 tool definitions. Tools execute by `app.inject(...)` against the existing Fastify routes. We don't unit-test the tools individually; the integration tests in Task 7 round-trip through the SDK.

**Files:**
- Create: `server/src/mcp/tools.ts`

- [ ] **Step 1: Create the file with all 11 tools**

Create `server/src/mcp/tools.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HaClient } from '../ha/types.js';

/** Helper: MCP returns tool results as `{content: [...]}`. We always return
 *  the JSON payload as a single text block. */
function jsonResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** Helper: MCP error tool result. The model sees the message and can retry. */
function errorResult(message: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Reusable inject wrapper — same pattern as agent/tools.ts. Returns the
 *  parsed JSON body on 2xx, or `{error, status}` on 4xx/5xx. */
async function inject<T = unknown>(
  app: FastifyInstance,
  opts: import('light-my-request').InjectOptions
): Promise<T | { error: string; status: number }> {
  const res = await app.inject(opts);
  if (res.statusCode >= 400) {
    let message = res.payload;
    try {
      const j = JSON.parse(res.payload) as { error?: string };
      if (typeof j.error === 'string') message = j.error;
    } catch {
      // raw text
    }
    return { error: message, status: res.statusCode };
  }
  if (res.statusCode === 204) return { ok: true } as unknown as T;
  try {
    return JSON.parse(res.payload) as T;
  } catch {
    return res.payload as unknown as T;
  }
}

export type McpToolDeps = {
  app: FastifyInstance;
  haClient: HaClient | null;
};

/** A single MCP tool definition: zod schema for input validation + an
 *  execute that returns an MCP tool result. Used by mcp/server.ts to
 *  register on the SDK's McpServer. */
export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (args: unknown) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
};

export function createMcpTools(deps: McpToolDeps): McpToolDef[] {
  const { app, haClient } = deps;

  return [
    {
      name: 'list_scenes',
      description:
        'List every scene on this Cosmos install with id, name, widget count, and default transition. Call this first when a user references a scene by name.',
      inputSchema: z.object({}),
      execute: async () => {
        const list = await inject<Array<{ id: string; name: string; widgets: unknown[]; defaultTransitionId: string | null }>>(
          app, { method: 'GET', url: '/api/scenes' }
        );
        if ('error' in list) return errorResult(list.error);
        return jsonResult(list.map((s) => ({
          id: s.id,
          name: s.name,
          widgetCount: Array.isArray(s.widgets) ? s.widgets.length : 0,
          defaultTransitionId: s.defaultTransitionId,
        })));
      },
    },

    {
      name: 'get_scene',
      description:
        'Fetch the full Scene object (layout, background, typography, widgets[], etc.) by id. Use only when you need to inspect non-widget fields; for widget tweaks use list_widgets + patch_widget instead.',
      inputSchema: z.object({ id: z.string() }),
      execute: async (raw) => {
        const args = raw as { id: string };
        const r = await inject(app, { method: 'GET', url: `/api/scenes/${encodeURIComponent(args.id)}` });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'create_scene',
      description:
        'Create a new scene. Payload follows the SceneInput shape from the Cosmos scene-authoring contract — name, layout (use cols=12, rows=8, items=[]), background, typography, widgets array. Read cosmos://docs/scene-agent for the full schema.',
      inputSchema: z.object({ payload: z.any() }),
      execute: async (raw) => {
        const args = raw as { payload: unknown };
        const r = await inject(app, { method: 'POST', url: '/api/scenes', payload: args.payload });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'update_scene',
      description:
        'Replace an entire scene with a new SceneInput payload. Heavy-handed — overwrites layout, background, typography, AND all widgets. Prefer patch_widget / update_widget_content for incremental edits.',
      inputSchema: z.object({ id: z.string(), payload: z.any() }),
      execute: async (raw) => {
        const args = raw as { id: string; payload: unknown };
        const r = await inject(app, { method: 'PUT', url: `/api/scenes/${encodeURIComponent(args.id)}`, payload: args.payload });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'list_widgets',
      description:
        'Flat list of every widget across every scene, with parent scene id+name. Filter with `scene` (id or name) and/or `kind`. Returns widget id, kind, position, and config (canvas content is truncated for context — use get_scene for the full content).',
      inputSchema: z.object({
        scene: z.string().optional(),
        kind: z.enum(['clock', 'weather', 'entity_tile', 'calendar', 'media_player', 'statistics', 'text', 'camera', 'canvas']).optional(),
      }),
      execute: async (raw) => {
        const args = raw as { scene?: string; kind?: string };
        const qs = new URLSearchParams();
        if (args.scene) qs.set('scene', args.scene);
        if (args.kind) qs.set('kind', args.kind);
        const url = qs.toString() ? `/api/widgets?${qs}` : '/api/widgets';
        const list = await inject<Array<{ id: string; sceneId: string; sceneName: string; kind: string; position: unknown; config: unknown }>>(
          app, { method: 'GET', url }
        );
        if ('error' in list) return errorResult(list.error);
        return jsonResult(list.map((w) => {
          const cfg = (w.config ?? {}) as Record<string, unknown>;
          const content = typeof cfg.content === 'string' ? cfg.content : null;
          return {
            id: w.id,
            sceneId: w.sceneId,
            sceneName: w.sceneName,
            kind: w.kind,
            position: w.position,
            config: content !== null && content.length > 500
              ? { ...cfg, content: content.slice(0, 500) + `… (${content.length} chars)` }
              : cfg,
          };
        }));
      },
    },

    {
      name: 'patch_widget',
      description:
        'Partial-update a single widget by id. `config` is shallow-merged into the existing config — keys you include override; keys you omit are preserved. For canvas content specifically, prefer update_widget_content.',
      inputSchema: z.object({
        id: z.string(),
        position: z.object({ col: z.number(), row: z.number(), w: z.number(), h: z.number() }).optional(),
        config: z.record(z.any()).optional(),
      }),
      execute: async (raw) => {
        const args = raw as { id: string; position?: unknown; config?: unknown };
        const r = await inject(app, {
          method: 'PATCH',
          url: `/api/widgets/${encodeURIComponent(args.id)}`,
          payload: { ...(args.position !== undefined ? { position: args.position } : {}), ...(args.config !== undefined ? { config: args.config } : {}) },
        });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'update_widget_content',
      description:
        'Replace the HTML content of a canvas widget by id. The shortcut for the most-edited canvas field. Returns an error if the widget is not a canvas.',
      inputSchema: z.object({
        id: z.string(),
        content: z.string(),
      }),
      execute: async (raw) => {
        const args = raw as { id: string; content: string };
        const r = await inject(app, {
          method: 'PUT',
          url: `/api/widgets/${encodeURIComponent(args.id)}/content`,
          payload: { content: args.content },
        });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'list_displays',
      description:
        'List every wall display registered with this Cosmos. Returns id, name, current/default scene ids, and last-seen timestamp.',
      inputSchema: z.object({}),
      execute: async () => {
        const r = await inject(app, { method: 'GET', url: '/api/displays' });
        if (typeof r === 'object' && r !== null && 'error' in r && 'status' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'assign_scene_to_display',
      description:
        'Link a scene to a display so the display can show it. Optionally set as the default (loaded on display reconnect). Does NOT push the scene live — the in-product agent has a separate confirm-required activate_scene tool that this MCP surface does not expose.',
      inputSchema: z.object({
        displayName: z.string(),
        sceneId: z.string(),
        makeDefault: z.boolean().optional(),
      }),
      execute: async (raw) => {
        const args = raw as { displayName: string; sceneId: string; makeDefault?: boolean };
        const r = await inject(app, {
          method: 'POST',
          url: `/api/displays/${encodeURIComponent(args.displayName)}/assign-scene`,
          payload: { sceneId: args.sceneId, makeDefault: args.makeDefault ?? false },
        });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'list_ha_entities',
      description:
        'List Home Assistant entities currently cached on this Cosmos. Optionally filter by domain (light, sensor, weather, media_player, etc.). The cosmos://entities resource holds a snapshot too; call this for fresh state.',
      inputSchema: z.object({ domain: z.string().optional() }),
      execute: async (raw) => {
        const args = raw as { domain?: string };
        if (!haClient) return errorResult('Home Assistant is not connected on this Cosmos instance.');
        const list = haClient.listEntities();
        const filtered = args.domain ? list.filter((e) => e.entity_id.startsWith(args.domain + '.')) : list;
        return jsonResult(filtered.map((e) => {
          const a = (e.attributes ?? {}) as Record<string, unknown>;
          return {
            entity_id: e.entity_id,
            state: e.state,
            friendly_name: typeof a.friendly_name === 'string' ? a.friendly_name : null,
            unit: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : null,
            device_class: typeof a.device_class === 'string' ? a.device_class : null,
          };
        }));
      },
    },

    {
      name: 'list_transitions',
      description:
        'List the available scene-transition descriptors. Use the returned id as `defaultTransitionId` in a SceneInput payload.',
      inputSchema: z.object({}),
      execute: async () => {
        const r = await inject(app, { method: 'GET', url: '/api/transitions' });
        if (typeof r === 'object' && r !== null && 'error' in r && 'status' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },
  ];
}
```

- [ ] **Step 2: Confirm typecheck passes**

Run:

```bash
npm --workspace server run build
```

Expected: clean. The new file isn't yet wired into the server, but it should compile.

- [ ] **Step 3: Commit**

```bash
git add server/src/mcp/tools.ts
git commit -m "feat(mcp): 11 tool definitions wrapping app.inject"
```

---

## Task 4: MCP resources

Three URI-keyed resources: two file-backed contracts (cached) + one live HA entity catalog (regenerated per fetch).

**Files:**
- Create: `server/src/mcp/resources.ts`

- [ ] **Step 1: Create the file**

Create `server/src/mcp/resources.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HaClient } from '../ha/types.js';
import { renderHaEntitiesDoc } from '../api/docs.js';

export type McpResourceDeps = {
  /** Absolute path to the bundled `docs/` directory (same one docs.ts uses). */
  docsDir: string;
  haClient: HaClient | null;
};

export type McpResourceListEntry = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

export type McpResourceContents = {
  uri: string;
  mimeType: string;
  text: string;
};

const URI_SCENE_AGENT = 'cosmos://docs/scene-agent';
const URI_CANVAS_AGENT = 'cosmos://docs/canvas-widget-agent';
const URI_ENTITIES = 'cosmos://entities';

/** The catalog the MCP server advertises in `resources/list`. */
export function listMcpResources(): McpResourceListEntry[] {
  return [
    {
      uri: URI_SCENE_AGENT,
      name: 'Scene authoring contract',
      description:
        'JSON schema and best practices for building a Cosmos Scene. Read this before calling create_scene.',
      mimeType: 'text/markdown',
    },
    {
      uri: URI_CANVAS_AGENT,
      name: 'Canvas widget contract',
      description:
        'HTML/CSS/JS rules and the cosmos.* JS bridge for canvas widgets. Read this before generating canvas content.',
      mimeType: 'text/markdown',
    },
    {
      uri: URI_ENTITIES,
      name: 'Live HA entity catalog',
      description:
        "Snapshot of every Home Assistant entity Cosmos has cached, grouped by domain. Use the listed entity_ids verbatim — don't invent ones.",
      mimeType: 'text/markdown',
    },
  ];
}

/** Cache the two file-backed contracts since they don't change at runtime. */
const cache = { sceneAgent: null as string | null, canvasAgent: null as string | null };

async function readContract(docsDir: string, slug: string, key: 'sceneAgent' | 'canvasAgent'): Promise<string> {
  if (cache[key] !== null) return cache[key]!;
  const filePath = join(docsDir, `${slug}.md`);
  if (!existsSync(filePath)) {
    cache[key] = `_(${slug}.md not bundled)_`;
    return cache[key]!;
  }
  cache[key] = await readFile(filePath, 'utf8');
  return cache[key]!;
}

/** Read a resource by URI. Returns null when the URI isn't recognized. */
export async function readMcpResource(
  uri: string,
  deps: McpResourceDeps
): Promise<McpResourceContents | null> {
  if (uri === URI_SCENE_AGENT) {
    return { uri, mimeType: 'text/markdown', text: await readContract(deps.docsDir, 'scene-agent', 'sceneAgent') };
  }
  if (uri === URI_CANVAS_AGENT) {
    return { uri, mimeType: 'text/markdown', text: await readContract(deps.docsDir, 'canvas-widget-agent', 'canvasAgent') };
  }
  if (uri === URI_ENTITIES) {
    return { uri, mimeType: 'text/markdown', text: renderHaEntitiesDoc(deps.haClient) };
  }
  return null;
}

/** Test-only: drop the doc cache so subsequent reads hit disk again. */
export function _resetMcpResourceCache(): void {
  cache.sceneAgent = null;
  cache.canvasAgent = null;
}
```

- [ ] **Step 2: Confirm typecheck passes**

Run:

```bash
npm --workspace server run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/mcp/resources.ts
git commit -m "feat(mcp): three resources (docs + live entity catalog)"
```

---

## Task 5: MCP server factory

Wire the SDK's `McpServer` with the tools and resources from Tasks 3–4. Pure factory — no HTTP knowledge.

**Files:**
- Create: `server/src/mcp/server.ts`

- [ ] **Step 1: Create the factory**

Create `server/src/mcp/server.ts`:

```typescript
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import type { HaClient } from '../ha/types.js';
import { createMcpTools, type McpToolDef } from './tools.js';
import { listMcpResources, readMcpResource } from './resources.js';

export type CreateMcpServerDeps = {
  app: FastifyInstance;
  haClient: HaClient | null;
  docsDir: string;
  /** Server `name` advertised to clients. */
  serverName?: string;
  /** Server `version` advertised to clients. Pulled from addon/config.yaml
   *  at the call site for accuracy. */
  serverVersion?: string;
};

/** Build a fresh MCP server with all 11 tools + 3 resources registered.
 *  Caller wires the result to a transport (StreamableHTTPServerTransport
 *  in our case) via `server.connect(transport)`. */
export function createCosmosMcpServer(deps: CreateMcpServerDeps): McpServer {
  const server = new McpServer({
    name: deps.serverName ?? 'cosmos',
    version: deps.serverVersion ?? '0.0.0',
  });

  // Tools
  const tools = createMcpTools({ app: deps.app, haClient: deps.haClient });
  for (const t of tools) {
    registerTool(server, t);
  }

  // Resources — register each known URI as a static resource.
  for (const r of listMcpResources()) {
    server.resource(
      r.name,
      r.uri,
      { description: r.description, mimeType: r.mimeType },
      async (uri) => {
        const result = await readMcpResource(uri.toString(), {
          docsDir: deps.docsDir,
          haClient: deps.haClient,
        });
        if (!result) {
          throw new Error(`Unknown resource: ${uri.toString()}`);
        }
        return { contents: [result] };
      }
    );
  }

  return server;
}

/** Adapter from our internal McpToolDef to the SDK's `server.tool(...)`
 *  signature. The SDK accepts a zod schema directly as the second arg in
 *  v1.29; the runtime will validate calls against it. */
function registerTool(server: McpServer, def: McpToolDef): void {
  // The SDK's tool() accepts (name, description?, paramsSchema, handler).
  // Use the McpServer's `tool` overload that takes the zod schema's shape
  // (the fields, not the wrapper). Our schemas are all z.object({...}) so
  // we extract `.shape`.
  const shape = (def.inputSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  server.tool(
    def.name,
    def.description,
    shape,
    async (args: unknown) => {
      const result = await def.execute(args);
      return result;
    }
  );
}
```

> **Note for the implementer:** The SDK in `1.29` exposes `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`. Its `tool()` method accepts a zod object **shape** (the inner record) rather than the full `z.object(...)` instance. If the API drifts in a patch release, use `Server` from `@modelcontextprotocol/sdk/server/index.js` plus `setRequestHandler(ListToolsRequestSchema, ...)` / `setRequestHandler(CallToolRequestSchema, ...)` instead — the `McpToolDef` shape is designed to drop into either path.

- [ ] **Step 2: Confirm typecheck**

Run:

```bash
npm --workspace server run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/mcp/server.ts
git commit -m "feat(mcp): McpServer factory wiring tools + resources"
```

---

## Task 6: Settings management endpoints

Three small HTTP endpoints the admin UI calls to inspect / toggle / regenerate the MCP token. They live in the new `api/mcp.ts` (alongside the transport endpoint added in Task 7).

**Files:**
- Create: `server/src/api/mcp.ts` (initial — settings only; transport added in Task 7)

- [ ] **Step 1: Create the file with the three settings endpoints**

Create `server/src/api/mcp.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import type { SettingsRepo } from '../store/settings.js';
import type { HaClient } from '../ha/types.js';
import {
  getToken,
  regenerateToken,
  isEnabled,
  setEnabled,
} from '../store/mcp-token.js';

export type McpRoutesDeps = {
  app: FastifyInstance;
  settings: SettingsRepo;
  haClient: HaClient | null;
  /** Path to the bundled docs/ directory; passed through to the MCP server
   *  factory so the resources can read the contracts off disk. */
  docsDir: string;
  /** Addon version to advertise to MCP clients. Optional; defaults to
   *  '0.0.0'. */
  serverVersion?: string;
};

type McpStatusResponse = {
  enabled: boolean;
  hasToken: boolean;
  /** Returned to the admin UI (same origin) so the user can copy it.
   *  Never returned from the /mcp transport endpoint. */
  token: string | null;
};

export function registerMcpRoutes(app: FastifyInstance, deps: McpRoutesDeps): void {
  /** GET /api/agent/mcp — settings card payload. */
  app.get('/api/agent/mcp', async (): Promise<McpStatusResponse> => {
    return {
      enabled: isEnabled(deps.settings),
      hasToken: getToken(deps.settings) !== null,
      token: getToken(deps.settings),
    };
  });

  /** POST /api/agent/mcp/enable — toggle the MCP server on or off. When
   *  enabling for the first time, automatically generate a token so the
   *  user doesn't have to make a second click. */
  app.post<{ Body: { enabled?: unknown } }>(
    '/api/agent/mcp/enable',
    async (req, reply): Promise<McpStatusResponse> => {
      const enabled = req.body?.enabled === true;
      setEnabled(deps.settings, enabled);
      if (enabled && getToken(deps.settings) === null) {
        regenerateToken(deps.settings);
      }
      return {
        enabled: isEnabled(deps.settings),
        hasToken: getToken(deps.settings) !== null,
        token: getToken(deps.settings),
      };
    }
  );

  /** POST /api/agent/mcp/regenerate — produce a new token. Old token is
   *  invalidated as soon as the new one is written. */
  app.post('/api/agent/mcp/regenerate', async (): Promise<McpStatusResponse> => {
    regenerateToken(deps.settings);
    return {
      enabled: isEnabled(deps.settings),
      hasToken: getToken(deps.settings) !== null,
      token: getToken(deps.settings),
    };
  });
}
```

- [ ] **Step 2: Confirm typecheck**

Run:

```bash
npm --workspace server run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/api/mcp.ts
git commit -m "feat(mcp): settings GET/enable/regenerate endpoints"
```

---

## Task 7: Auth gate + Streamable HTTP transport

Mount the MCP transport at `POST /mcp` with an auth `preHandler`. Use a fresh `StreamableHTTPServerTransport` per request in **stateless mode** so multiple concurrent clients don't have to coordinate session state.

**Files:**
- Modify: `server/src/api/mcp.ts`

- [ ] **Step 1: Append the transport endpoint to api/mcp.ts**

Append to `server/src/api/mcp.ts`:

```typescript
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createCosmosMcpServer } from '../mcp/server.js';

/** Auth preHandler — runs before every /mcp request. Returns 503 if MCP
 *  isn't enabled or no token is set, 401 if the bearer is missing/wrong,
 *  passes through otherwise. */
function mcpAuth(deps: { settings: SettingsRepo }) {
  return async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!isEnabled(deps.settings)) {
      reply.code(503).send({ error: 'MCP server not enabled' });
      return reply;
    }
    const expected = getToken(deps.settings);
    if (!expected) {
      reply.code(503).send({ error: 'MCP token not generated' });
      return reply;
    }
    const header = req.headers.authorization ?? '';
    const got = header.replace(/^Bearer\s+/i, '');
    // timingSafeEqual requires equal-length buffers — short-circuit length
    // mismatch with the same error so the client can't infer length.
    const expectedBuf = Buffer.from(expected);
    const gotBuf = Buffer.from(got);
    const ok = gotBuf.length === expectedBuf.length && timingSafeEqual(gotBuf, expectedBuf);
    if (!ok) {
      reply.code(401).send({ error: 'invalid or missing bearer token' });
      return reply;
    }
  };
}

/** Mount the MCP transport. Called from registerMcpRoutes after the
 *  settings endpoints. */
export function registerMcpTransport(app: FastifyInstance, deps: McpRoutesDeps): void {
  const auth = mcpAuth({ settings: deps.settings });

  // POST /mcp — JSON-RPC over HTTP, optionally upgrading to SSE for
  // long-running tool calls. The SDK transport handles the protocol
  // entirely; we just hand it the raw req/res streams.
  app.post('/mcp', { preHandler: auth }, async (req, reply) => {
    const server = createCosmosMcpServer({
      app: deps.app,
      haClient: deps.haClient,
      docsDir: deps.docsDir,
      serverVersion: deps.serverVersion,
    });
    const transport = new StreamableHTTPServerTransport({
      // Stateless mode — no session ID, every POST is independent. Matches
      // our stateless tool-execution model (every tool call is a fresh
      // app.inject, no session state to track).
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      console.error('[mcp] transport error', err);
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
      }
      try { reply.raw.end(); } catch { /* ignore */ }
    } finally {
      try { await transport.close(); } catch { /* ignore */ }
      try { await server.close(); } catch { /* ignore */ }
    }
  });

  // GET /mcp returns 405 — the StreamableHTTP spec uses POST for client→
  // server and reserves GET for server-initiated SSE in stateful mode,
  // which we don't support.
  app.get('/mcp', { preHandler: auth }, async (_req, reply) => {
    reply.code(405).send({ error: 'GET not supported in stateless mode; POST to /mcp instead' });
  });
}
```

- [ ] **Step 2: Update registerMcpRoutes to call registerMcpTransport**

Edit the existing `registerMcpRoutes` function body in `server/src/api/mcp.ts`. After the three settings endpoints, add:

```typescript
  registerMcpTransport(app, deps);
```

So the full function looks like:

```typescript
export function registerMcpRoutes(app: FastifyInstance, deps: McpRoutesDeps): void {
  // ... GET /api/agent/mcp ...
  // ... POST /api/agent/mcp/enable ...
  // ... POST /api/agent/mcp/regenerate ...
  registerMcpTransport(app, deps);
}
```

- [ ] **Step 3: Confirm typecheck**

Run:

```bash
npm --workspace server run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/api/mcp.ts
git commit -m "feat(mcp): auth gate + StreamableHTTP transport at POST /mcp"
```

---

## Task 8: Wire MCP routes into http.ts

**Files:**
- Modify: `server/src/api/http.ts`

- [ ] **Step 1: Add the import + the registration**

Edit `server/src/api/http.ts`. Add at the top with the other route imports:

```typescript
import { registerMcpRoutes } from './mcp.js';
```

Inside `buildHttpApp(deps)`, after `registerAgentRoutes(...)` (which sits after `registerDocsRoutes`), add:

```typescript
  registerMcpRoutes(app, {
    app,
    settings: deps.settings,
    haClient: deps.haClient ?? null,
    docsDir: deps.docsDir ?? '',
  });
```

(`docsDir` may be undefined when running unit tests; passing `''` is safe — `readMcpResource` falls back to a "not bundled" message.)

- [ ] **Step 2: Confirm typecheck + existing tests still pass**

Run:

```bash
npm --workspace server run build && npm --workspace server test
```

Expected: clean build, 216 tests pass (210 existing + 6 from Task 2).

- [ ] **Step 3: Commit**

```bash
git add server/src/api/http.ts
git commit -m "feat(mcp): wire registerMcpRoutes into buildHttpApp"
```

---

## Task 9: Integration tests

The full round-trip: auth gate, tools/list, tool call, resources/list, resource read, regenerate-invalidates-old-token.

**Files:**
- Create: `server/test/mcp-server.test.ts`

- [ ] **Step 1: Write the integration tests**

Create `server/test/mcp-server.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';
import { createCanvasExtrasStore } from '../src/api/canvases.js';
import { createFakeHaClient } from '../src/ha/fakeClient.js';
import { regenerateToken, setEnabled } from '../src/store/mcp-token.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return {
    displays: createDisplaysRepo(db),
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
    canvasExtras: createCanvasExtrasStore(),
  };
}

const sceneFixture = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid' as const, color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { kind: 'clock' as const, position: { col: 1, row: 1, w: 6, h: 2 }, config: { format: '24h' } },
  ],
};

/** Helper — POST a JSON-RPC body to /mcp with the given auth header. */
async function rpc(
  app: Awaited<ReturnType<typeof buildHttpApp>>,
  body: object,
  authHeader?: string
) {
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    payload: body,
  });
}

describe('MCP /mcp transport', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    app = await buildHttpApp({ ...ctx, haClient: createFakeHaClient([
      { entity_id: 'sensor.power', state: '1247', attributes: { friendly_name: 'Power', unit_of_measurement: 'W' } },
    ]) });
  });

  it('returns 503 when MCP is disabled', async () => {
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/not enabled/i);
  });

  it('returns 503 when enabled but no token', async () => {
    setEnabled(ctx.settings, true);
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/token not generated/i);
  });

  it('returns 401 when the bearer is missing', async () => {
    setEnabled(ctx.settings, true);
    regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the bearer is wrong', async () => {
    setEnabled(ctx.settings, true);
    regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'Bearer wrong-token');
    expect(res.statusCode).toBe(401);
  });

  it('tools/list with the right bearer returns the 11 tools', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.tools).toHaveLength(11);
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      'assign_scene_to_display',
      'create_scene',
      'get_scene',
      'list_displays',
      'list_ha_entities',
      'list_scenes',
      'list_transitions',
      'list_widgets',
      'patch_widget',
      'update_scene',
      'update_widget_content',
    ]);
    // No destructive tools.
    expect(names).not.toContain('activate_scene');
    expect(names).not.toContain('delete_scene');
    expect(names).not.toContain('delete_widget');
  });

  it('tools/call create_scene round-trips through app.inject', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'create_scene', arguments: { payload: sceneFixture } },
    }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.content[0].type).toBe('text');
    const created = JSON.parse(body.result.content[0].text);
    expect(created.name).toBe('Morning');
    expect(created.id).toBeTruthy();
    // And the scene actually landed in the repo.
    expect(ctx.scenes.list().map((s) => s.name)).toContain('Morning');
  });

  it('tools/call surfaces validation errors as isError:true', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'create_scene', arguments: { payload: { name: 'bad' } } },
    }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/invalid scene payload/i);
  });

  it('resources/list returns the three known URIs', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 4, method: 'resources/list' }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const uris = res.json().result.resources.map((r: { uri: string }) => r.uri).sort();
    expect(uris).toEqual([
      'cosmos://docs/canvas-widget-agent',
      'cosmos://docs/scene-agent',
      'cosmos://entities',
    ]);
  });

  it('resources/read returns the live entity catalog', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/read',
      params: { uri: 'cosmos://entities' },
    }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.contents[0].mimeType).toBe('text/markdown');
    expect(body.result.contents[0].text).toContain('sensor.power');
  });

  it('regenerate invalidates the old token immediately', async () => {
    setEnabled(ctx.settings, true);
    const oldToken = regenerateToken(ctx.settings);
    const ok = await rpc(app, { jsonrpc: '2.0', id: 6, method: 'tools/list' }, `Bearer ${oldToken}`);
    expect(ok.statusCode).toBe(200);

    regenerateToken(ctx.settings); // server-side rotation

    const stale = await rpc(app, { jsonrpc: '2.0', id: 7, method: 'tools/list' }, `Bearer ${oldToken}`);
    expect(stale.statusCode).toBe(401);
  });

  it('settings GET returns config; enable+regenerate flow works', async () => {
    let res = await app.inject({ method: 'GET', url: '/api/agent/mcp' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled: false, hasToken: false, token: null });

    res = await app.inject({
      method: 'POST',
      url: '/api/agent/mcp/enable',
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    const enabled = res.json();
    expect(enabled.enabled).toBe(true);
    expect(enabled.hasToken).toBe(true);
    expect(enabled.token).toMatch(/^cosmos_mcp_/);

    res = await app.inject({ method: 'POST', url: '/api/agent/mcp/regenerate' });
    expect(res.statusCode).toBe(200);
    const regenerated = res.json();
    expect(regenerated.token).not.toBe(enabled.token);
    expect(regenerated.token).toMatch(/^cosmos_mcp_/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run:

```bash
npm --workspace server test -- mcp-server
```

Expected: PASS — 11 tests.

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run:

```bash
npm --workspace server test
```

Expected: 227 tests pass (210 existing + 6 from Task 2 + 11 from this task).

- [ ] **Step 4: Commit**

```bash
git add server/test/mcp-server.test.ts
git commit -m "test(mcp): integration tests for auth, tools, resources, rotation"
```

---

## Task 10: Display API client helpers

**Files:**
- Modify: `display/src/lib/admin/api.ts`

- [ ] **Step 1: Add the three helpers to the agent group**

Edit `display/src/lib/admin/api.ts`. In the `agent: { ... }` block, after `updateSettings`, add:

```typescript
    async getMcpConfig(): Promise<{ enabled: boolean; hasToken: boolean; token: string | null }> {
      const res = await fetch('/api/agent/mcp');
      return (await res.json()) as { enabled: boolean; hasToken: boolean; token: string | null };
    },
    async enableMcp(enabled: boolean): Promise<{ enabled: boolean; hasToken: boolean; token: string | null }> {
      const res = await fetch('/api/agent/mcp/enable', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await ensureOk(res);
      return (await res.json()) as { enabled: boolean; hasToken: boolean; token: string | null };
    },
    async regenerateMcpToken(): Promise<{ enabled: boolean; hasToken: boolean; token: string | null }> {
      const res = await fetch('/api/agent/mcp/regenerate', { method: 'POST' });
      await ensureOk(res);
      return (await res.json()) as { enabled: boolean; hasToken: boolean; token: string | null };
    },
```

- [ ] **Step 2: Confirm display build**

Run:

```bash
npm --workspace display run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add display/src/lib/admin/api.ts
git commit -m "feat(mcp): admin API helpers for MCP settings"
```

---

## Task 11: Settings card UI

**Files:**
- Modify: `display/src/routes/admin/settings/+page.svelte`

- [ ] **Step 1: Add MCP state to the script section**

Edit `display/src/routes/admin/settings/+page.svelte`. In the `<script lang="ts">` block, alongside the existing `agentKeyInput`/`agentModel` state, add:

```typescript
  // MCP server state — fetched on mount alongside the other settings.
  let mcpEnabled = false;
  let mcpHasToken = false;
  let mcpToken: string | null = null;
  let savingMcp = false;
  let mcpCopied = false;
  let snippetCopied = false;
```

- [ ] **Step 2: Fetch MCP state in onMount**

Edit the existing `onMount(async () => { ... })` body. Replace the current `Promise.all` with:

```typescript
    const [sa, ts, ag, mcp] = await Promise.all([
      api.settings.getSafeArea(),
      api.settings.getTransitionSpeed(),
      api.agent.getSettings().catch(() => ({ hasKey: false, model: '', confirmRequiredTools: [] })),
      api.agent.getMcpConfig().catch(() => ({ enabled: false, hasToken: false, token: null })),
    ]);
    safeArea = sa;
    transitionSpeed = ts.multiplier;
    transitionSpeedRange = { min: ts.min, max: ts.max, default: ts.default };
    agentHasKey = ag.hasKey;
    agentModel = ag.model;
    mcpEnabled = mcp.enabled;
    mcpHasToken = mcp.hasToken;
    mcpToken = mcp.token;
    loaded = true;
```

- [ ] **Step 3: Add the MCP-control functions**

In the same `<script>`, alongside `saveAgent` etc., add:

```typescript
  async function toggleMcp(next: boolean) {
    savingMcp = true;
    try {
      const res = await api.agent.enableMcp(next);
      mcpEnabled = res.enabled;
      mcpHasToken = res.hasToken;
      mcpToken = res.token;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'failed to toggle MCP');
    } finally {
      savingMcp = false;
    }
  }

  async function regenerateMcp() {
    if (!confirm('Regenerating will disconnect any agent currently connected. They’ll need the new token. Continue?')) return;
    savingMcp = true;
    try {
      const res = await api.agent.regenerateMcpToken();
      mcpEnabled = res.enabled;
      mcpHasToken = res.hasToken;
      mcpToken = res.token;
    } finally {
      savingMcp = false;
    }
  }

  async function copyMcpToken() {
    if (!mcpToken) return;
    await navigator.clipboard.writeText(mcpToken);
    mcpCopied = true;
    setTimeout(() => (mcpCopied = false), 1600);
  }

  function mcpEndpoint(): string {
    if (typeof window === 'undefined') return '/mcp';
    return `${window.location.origin}/mcp`;
  }

  function mcpClaudeSnippet(): string {
    return JSON.stringify({
      mcpServers: {
        cosmos: {
          url: mcpEndpoint(),
          headers: { Authorization: `Bearer ${mcpToken ?? '<token>'}` },
        },
      },
    }, null, 2);
  }

  async function copyMcpSnippet() {
    await navigator.clipboard.writeText(mcpClaudeSnippet());
    snippetCopied = true;
    setTimeout(() => (snippetCopied = false), 1600);
  }
```

- [ ] **Step 4: Add the card markup**

In the `<template>` section, after the existing **AI agent** card (the one with `class="card reveal reveal-4"`), add a new card:

```svelte
  <section class="card reveal reveal-5">
    <h2>Agent-to-agent (MCP)</h2>
    <p class="hint">
      Let external agents (Claude Desktop, Cursor, etc.) connect to Cosmos to inspect and edit
      your wall display. Read + edit only — destructive actions are never exposed over MCP.
    </p>

    <label class="toggle">
      <input
        type="checkbox"
        checked={mcpEnabled}
        on:change={(e) => toggleMcp((e.currentTarget as HTMLInputElement).checked)}
        disabled={savingMcp}
      />
      <span>Enable MCP server</span>
    </label>

    {#if mcpEnabled}
      <div class="mcp-grid">
        <Field label="Endpoint">
          <input type="text" readonly value={mcpEndpoint()} />
        </Field>

        <Field label="Bearer token">
          <div class="token-row">
            <input type="text" readonly value={mcpToken ?? ''} />
            <button type="button" class="ghost" on:click={copyMcpToken} disabled={!mcpToken}>
              {mcpCopied ? '✓ Copied' : 'Copy'}
            </button>
            <button type="button" class="ghost" on:click={regenerateMcp} disabled={savingMcp}>
              Regenerate
            </button>
          </div>
        </Field>

        <Field label="Claude Desktop config snippet">
          <div class="snippet-row">
            <pre class="snippet">{mcpClaudeSnippet()}</pre>
            <button type="button" class="ghost" on:click={copyMcpSnippet} disabled={!mcpToken}>
              {snippetCopied ? '✓ Copied' : 'Copy snippet'}
            </button>
          </div>
        </Field>
      </div>
    {/if}
  </section>
```

- [ ] **Step 5: Add minimal CSS for the new card elements**

In the existing `<style>` block at the bottom of the file, add:

```css
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
    user-select: none;
    margin: 0.5rem 0 1rem;
  }
  .toggle input { width: 1.1rem; height: 1.1rem; min-height: 0; }

  .mcp-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .token-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .token-row input { flex: 1 1 18rem; min-width: 0; }
  .snippet-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .snippet {
    background: var(--c-bg);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0.85rem;
    margin: 0;
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    overflow-x: auto;
    color: var(--c-fg-2);
  }
```

- [ ] **Step 6: Verify display build**

Run:

```bash
npm --workspace display run build
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add display/src/routes/admin/settings/+page.svelte
git commit -m "feat(mcp): Settings card with toggle, token, and Claude Desktop snippet"
```

---

## Task 12: Bump addon version + changelog

**Files:**
- Modify: `addon/config.yaml`
- Modify: `addon/CHANGELOG.md`

- [ ] **Step 1: Bump version**

Edit `addon/config.yaml`:

```yaml
version: "0.5.0"
```

(Replace the current `0.4.x` value; this is a notable user-visible feature, so a minor bump.)

- [ ] **Step 2: Add changelog entry**

Edit `addon/CHANGELOG.md`. Insert at the top, just after the `# Changelog` heading:

```markdown
## 0.5.0

- Feat: New **Agent-to-agent (MCP)** server. External agents (Claude Desktop, Cursor, etc.) can now connect to Cosmos via the Model Context Protocol to list, inspect, create, and edit scenes and canvas widgets — same execution path as the in-product agent. Off by default; enable in Settings → **Agent-to-agent (MCP)**, copy the bearer token + the Claude Desktop config snippet, and paste into your client's MCP config. Read + edit only — destructive actions (activate / delete) are never exposed.
```

- [ ] **Step 3: Final full verification**

Run all three:

```bash
npm --workspace server run build
npm --workspace server test
npm --workspace display run build
```

Expected: server build clean, 227 server tests pass, display build clean.

- [ ] **Step 4: Commit**

```bash
git add addon/config.yaml addon/CHANGELOG.md
git commit -m "chore(addon): bump to 0.5.0 — MCP server"
```

- [ ] **Step 5: Push the branch**

```bash
git push origin dev
```

---

## Manual verification (post-merge smoke)

After the implementer ships and the addon updates on the user's HA setup:

1. **Settings UI loads** — open `/admin/settings`, scroll to **Agent-to-agent (MCP)**. Toggle is off by default.
2. **Enable + token appears** — flip the toggle. Endpoint URL, token, and Claude Desktop snippet appear.
3. **`curl` handshake** — copy the token, run:
   ```bash
   curl -X POST http://localhost:8099/mcp \
     -H "Authorization: Bearer cosmos_mcp_..." \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```
   Expect a JSON response listing 11 tools.
4. **Claude Desktop** — paste the snippet into Claude Desktop's MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS), restart Claude Desktop, and ask *"What scenes do I have on my Cosmos?"* The model calls `list_scenes` and summarizes.
5. **Resource attach** — in Claude Desktop's MCP panel, see `cosmos://entities`, `cosmos://docs/scene-agent`, `cosmos://docs/canvas-widget-agent` listed. Attaching one as context should drop its markdown into the prompt.
6. **Regenerate** — click Regenerate in Settings. Confirm dialog appears. After regenerating, Claude Desktop's next message returns 401; reconfiguring with the new token restores access.
7. **Disable** — flip the toggle off. Subsequent `curl` returns 503.
