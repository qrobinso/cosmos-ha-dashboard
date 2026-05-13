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
 *  parsed JSON body on 2xx, or `{error, status}` on 4xx/5xx.
 *
 *  Be defensive about content-type: LLM tool calls sometimes deliver
 *  `payload` as a JSON-stringified string instead of a parsed object. In
 *  that case light-my-request can't infer JSON and the route 415s with no
 *  body to debug from. We always normalize: parse strings if possible,
 *  re-stringify objects, and set `content-type: application/json` —
 *  works regardless of how the SDK delivered the args. */
async function inject<T = unknown>(
  app: FastifyInstance,
  opts: import('light-my-request').InjectOptions
): Promise<T | { error: string; status: number }> {
  const normalized = normalizeInject(opts);
  const res = await app.inject(normalized);
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

function normalizeInject(opts: import('light-my-request').InjectOptions): import('light-my-request').InjectOptions {
  if (opts.payload === undefined || opts.payload === null) return opts;
  let body: unknown = opts.payload;
  // If it's a string that parses as JSON, treat it as JSON. (Some MCP
  // clients double-encode tool args as a stringified JSON value.)
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { body = JSON.parse(trimmed); } catch { /* keep as raw string */ }
    }
  }
  // Buffers and primitive strings pass through unchanged. Everything else
  // gets stringified with an explicit JSON content-type.
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
    return {
      ...opts,
      payload: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    };
  }
  return opts;
}

export type McpToolDeps = {
  app: FastifyInstance;
  haClient: HaClient | null;
};

/** A single MCP tool definition: zod schema for input validation + an
 *  execute that returns an MCP tool result. Used by mcp/server.ts to
 *  register on the SDK's McpServer.
 *
 *  Two optional fields support the in-product agent adapter (agent/tools.ts)
 *  without changing MCP behavior:
 *
 *  `confirmRequired` — marks destructive/visible-side-effect tools that the
 *  in-product agent should defer to the user before running. MCP servers
 *  register full execute; the in-product agent's adapter strips execute so
 *  the chat UI can show a confirm card. Today: activate_scene, delete_scene,
 *  delete_widget.
 *
 *  `summarizeForAgent` — optional projection applied by the in-product agent
 *  ONLY (not MCP) to compact a tool result before returning it to the model.
 *  Used by list_widgets to truncate canvas content. MCP clients see the raw
 *  result so external integrations aren't surprised by hidden trimming. */
export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (args: unknown) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
  /** Marks destructive/visible-side-effect tools that the in-product agent
   *  should defer to the user before running. MCP servers register full
   *  execute; the in-product agent's adapter strips execute so the chat
   *  UI can show a confirm card. Today: activate_scene, delete_scene,
   *  delete_widget. */
  confirmRequired?: boolean;
  /** Optional projection applied by the in-product agent ONLY (not MCP)
   *  to compact a tool result before returning it to the model. Used by
   *  list_widgets to truncate canvas content. MCP clients see the raw
   *  result so external integrations aren't surprised by hidden trimming. */
  summarizeForAgent?: (raw: unknown) => unknown;
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
        'Create a new scene. Payload follows the SceneInput shape from the Cosmos scene-authoring contract — name, layout (use cols=12, rows=8, items=[]), background, typography, widgets array. Read cosmos://docs/scene-agent for the full schema. Read cosmos://docs/wall-display-principles first — this is a wall display viewed from across a room, not a web page; one focal point per scene, ≤4 widgets, glanceable in 3 seconds.',
      inputSchema: z.object({ payload: z.any() }),
      execute: async (raw) => {
        const args = raw as { payload: unknown };
        const r = await inject(app, { method: 'POST', url: '/api/scenes', payload: args.payload as import('light-my-request').InjectPayload });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'update_scene',
      description:
        '⚠️ HEAVY — REPLACES an entire scene including every widget verbatim. Each widget object you include is stored EXACTLY as you sent it: if a widget in the payload has `config: {}` then that widget\'s previous config (e.g. canvas content) is WIPED. There is no merge, no preserve-on-omit. So in 90% of cases you should NOT use this tool. Instead: use `patch_scene` for top-level metadata (background, typography, mood, name, transition); use `patch_widget` for one widget\'s position or partial config; use `update_widget_content` for canvas HTML. Only call `update_scene` when the user wants a wholesale rewrite. If you do, first call `get_scene` to fetch current widgets verbatim and pass them through unchanged. Full SceneInput shape: `cosmos://docs/scene-agent`. Read cosmos://docs/wall-display-principles first — this is a wall display viewed from across a room, not a web page; one focal point per scene, ≤4 widgets, glanceable in 3 seconds.',
      inputSchema: z.object({ id: z.string(), payload: z.any() }),
      execute: async (raw) => {
        const args = raw as { id: string; payload: unknown };
        const r = await inject(app, { method: 'PUT', url: `/api/scenes/${encodeURIComponent(args.id)}`, payload: args.payload as import('light-my-request').InjectPayload });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'patch_scene',
      description:
        "Partial-update a scene's metadata (background, typography, mood, name, default transition, layout, floatWidgets). Widgets are NEVER touched by this — use `patch_widget` / `update_widget_content` for those. Pass only the keys you want to change; everything you omit is preserved. Use this for \"change the background to a sunrise gradient\", \"turn off the mood video\", \"rename the scene\", etc. — much lighter than `update_scene`. See cosmos://docs/wall-display-principles — this is a wall display viewed from across a room; keep one focal point per scene, glanceable in 3 seconds.",
      inputSchema: z.object({
        id: z.string(),
        name: z.string().optional(),
        // `items` is the array of WidgetLayoutItem objects on the scene's
        // grid. Use `z.unknown()` (not `z.any()`) for the element type so
        // the zod→JSON-Schema conversion emits `items: {}` rather than
        // dropping the `items` keyword entirely — Azure/OpenAI strict-mode
        // tool validation rejects arrays without `items` ("array schema
        // missing items"), which otherwise breaks every OpenAI-family
        // model. Anthropic accepts both shapes, hence the bug only
        // surfaced on OpenAI/Azure-routed providers.
        layout: z.object({ cols: z.number(), rows: z.number(), items: z.array(z.unknown()).optional() }).optional(),
        // Use a permissive object shape rather than z.any() so MCP clients
        // see "type": "object" in the JSON Schema and pass the value through
        // as an object (not string-coerced). The REST layer enforces the
        // solid|gradient union — declaring it as a discriminated union here
        // would lock out forward-compatible additions.
        background: z.object({ type: z.string() }).passthrough().optional()
          .describe('Background union — {type:"solid",color} or {type:"gradient",colors,speed,style,sun_adaptive?}.'),
        typography: z.object({ font_family: z.string().optional(), font_scale: z.number().optional(), color: z.string().optional() }).partial().optional(),
        defaultTransitionId: z.string().nullable().optional(),
        floatWidgets: z.boolean().optional(),
        // Same reason as background — give MCP clients an object hint.
        mood: z.object({ enabled: z.boolean() }).passthrough().optional()
          .describe('Mood config — {enabled, strategy: manual|time|weather, moodId?, weatherEntity?, opacity?}.'),
      }),
      execute: async (raw) => {
        const args = raw as { id: string } & Record<string, unknown>;
        const { id, ...patch } = args;
        const r = await inject(app, {
          method: 'PATCH',
          url: `/api/scenes/${encodeURIComponent(id)}`,
          payload: patch as import('light-my-request').InjectPayload,
        });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'list_widgets',
      description:
        'Flat list of every widget across every scene, with parent scene id+name. Filter with `scene` (id or name), `kind`, and/or `name` (matches config.name exactly, case-insensitively — useful when the user calls a canvas by name). Returns widget id, kind, name, position, and config (canvas content is truncated for the in-product agent — use get_scene for the full content).',
      inputSchema: z.object({
        scene: z.string().optional(),
        kind: z.enum(['clock', 'weather', 'entity_tile', 'calendar', 'media_player', 'statistics', 'text', 'camera', 'canvas']).optional(),
        name: z.string().optional().describe('Filter by config.name (case-insensitive exact match). Best paired with kind=canvas.'),
      }),
      execute: async (raw) => {
        const args = raw as { scene?: string; kind?: string; name?: string };
        const qs = new URLSearchParams();
        if (args.scene) qs.set('scene', args.scene);
        if (args.kind) qs.set('kind', args.kind);
        if (args.name) qs.set('name', args.name);
        const url = qs.toString() ? `/api/widgets?${qs}` : '/api/widgets';
        const list = await inject<Array<{ id: string; sceneId: string; sceneName: string; kind: string; position: unknown; config: unknown }>>(
          app, { method: 'GET', url }
        );
        if ('error' in list) return errorResult(list.error);
        return jsonResult(list);
      },
      /** Compact projection for the in-product agent: truncates canvas HTML
       *  content to 500 chars so list_widgets doesn't blow the context window
       *  with 50KB of HTML when the agent just needs to know what's there.
       *  MCP clients receive the raw list from execute (no truncation). */
      summarizeForAgent: (raw) => {
        const list = raw as Array<{ id: string; sceneId: string; sceneName: string; kind: string; position: unknown; config: unknown }>;
        if (!Array.isArray(list)) return list;
        return list.map((w) => {
          const cfg = (w.config ?? {}) as Record<string, unknown>;
          const content = typeof cfg.content === 'string' ? cfg.content : null;
          const cfgName = typeof cfg.name === 'string' ? cfg.name : null;
          return {
            id: w.id,
            sceneId: w.sceneId,
            sceneName: w.sceneName,
            kind: w.kind,
            name: cfgName,
            position: w.position,
            config: content !== null && content.length > 500
              ? { ...cfg, content: content.slice(0, 500) + `… (${content.length} chars)` }
              : cfg,
          };
        });
      },
    },

    {
      name: 'patch_widget',
      description:
        'Partial-update a single widget by id. `config` is shallow-merged into the existing config — keys you include override; keys you omit are preserved. For canvas content specifically, prefer update_widget_content. When patching canvas content, read cosmos://docs/wall-display-principles and cosmos://docs/canvas-widget-agent first: one hero per widget, heavy/large hero type calc\'d against --cosmos-font-scale, defend every entity read with a default, no attention-grabbing motion in widget content.',
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
        'Replace the HTML content of a canvas widget by id. The shortcut for the most-edited canvas field. Returns an error if the widget is not a canvas. Read cosmos://docs/wall-display-principles and cosmos://docs/canvas-widget-agent first: one hero per widget, heavy/large hero type calc\'d against --cosmos-font-scale, defend every entity read with a default, no attention-grabbing motion in widget content.',
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
        'Link a scene to a display so the display can show it. Optionally set as the default (loaded on display reconnect). Does NOT push the scene live — use activate_scene for that.',
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
      name: 'get_display_palette',
      description:
        'Read the live color palette extracted from a display\'s widgets. Returns the colors currently driving the adaptive gradient (if enabled) plus when they were last updated. Empty colors means nothing is being reported. Useful for "what colors are showing on the kitchen wall right now?" questions.',
      inputSchema: z.object({
        displayName: z.string().describe('The display name (e.g. "kitchen-wall"), as used by /api/displays/<name>/...'),
      }),
      execute: async (raw) => {
        const args = raw as { displayName: string };
        const r = await inject(app, {
          method: 'GET',
          url: `/api/displays/${encodeURIComponent(args.displayName)}/palette`,
        });
        if (typeof r === 'object' && r !== null && 'error' in r && 'status' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'list_ha_entities',
      description:
        'List Home Assistant entities cached on this Cosmos. Filters AND-combine. With thousands of entities you should ALWAYS narrow with at least one of `domain` / `device_class` / `search` before reading — start with `summarize_ha_entities` if you have no idea where to look. `search` is a case-insensitive substring matched against entity_id + friendly_name. `limit` caps the response (default 200) to keep context lean.',
      inputSchema: z.object({
        domain: z.string().optional().describe('Exact domain prefix, e.g. "sensor" matches sensor.*.'),
        device_class: z.string().optional().describe('Match attributes.device_class (e.g. "temperature", "motion").'),
        search: z.string().optional().describe('Substring matched against entity_id + friendly_name (case-insensitive).'),
        limit: z.number().int().positive().optional().describe('Cap the number of results returned. Default 200.'),
      }),
      execute: async (raw) => {
        const args = raw as { domain?: string; device_class?: string; search?: string; limit?: number };
        if (!haClient) return errorResult('Home Assistant is not connected on this Cosmos instance.');
        let list = haClient.listEntities();
        if (args.domain) list = list.filter((e) => e.entity_id.startsWith(args.domain + '.'));
        if (args.device_class) {
          list = list.filter((e) => {
            const a = (e.attributes ?? {}) as Record<string, unknown>;
            return a.device_class === args.device_class;
          });
        }
        if (args.search) {
          const q = args.search.toLowerCase();
          list = list.filter((e) => {
            if (e.entity_id.toLowerCase().includes(q)) return true;
            const a = (e.attributes ?? {}) as Record<string, unknown>;
            const fn = typeof a.friendly_name === 'string' ? a.friendly_name.toLowerCase() : '';
            return fn.includes(q);
          });
        }
        const fullCount = list.length;
        const limit = args.limit && args.limit > 0 ? args.limit : 200;
        const truncated = list.length > limit;
        if (truncated) list = list.slice(0, limit);
        return jsonResult({
          count: list.length,
          totalMatches: fullCount,
          truncated,
          entities: list.map((e) => {
            const a = (e.attributes ?? {}) as Record<string, unknown>;
            return {
              entity_id: e.entity_id,
              state: e.state,
              friendly_name: typeof a.friendly_name === 'string' ? a.friendly_name : null,
              unit: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : null,
              device_class: typeof a.device_class === 'string' ? a.device_class : null,
            };
          }),
        });
      },
    },

    {
      name: 'summarize_ha_entities',
      description:
        'Orientation snapshot of the HA install — `{total, domains: {sensor: 412, light: 38, ...}, deviceClasses: {temperature: 14, motion: 8, ...}}`. Tiny payload. Call this FIRST when you have no idea what entities exist, then narrow with `list_ha_entities`. Far cheaper than dumping thousands of entities into your context up-front.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!haClient) return errorResult('Home Assistant is not connected on this Cosmos instance.');
        const all = haClient.listEntities();
        const domains: Record<string, number> = {};
        const deviceClasses: Record<string, number> = {};
        for (const e of all) {
          const dot = e.entity_id.indexOf('.');
          if (dot > 0) {
            const d = e.entity_id.slice(0, dot);
            domains[d] = (domains[d] ?? 0) + 1;
          }
          const a = (e.attributes ?? {}) as Record<string, unknown>;
          if (typeof a.device_class === 'string') {
            deviceClasses[a.device_class] = (deviceClasses[a.device_class] ?? 0) + 1;
          }
        }
        return jsonResult({ total: all.length, domains, deviceClasses });
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
        'Create a new user design pack. The content must follow the DESIGN.md spec (https://github.com/google-labs-code/design.md): YAML frontmatter with `colors`, `typography`, optional `rounded` / `spacing` / `components`, then markdown body in canonical section order (Overview, Colors, Typography, Layout, Elevation, Shapes, Components, Do\'s and Don\'ts). Slug must be lowercase, hyphen-separated, 3-64 chars. Read cosmos://docs/scene-agent and the existing built-in packs (cosmos://designs/<slug>) for examples before writing one. A design pack supplements the wall-display principles (cosmos://docs/wall-display-principles) — it must not encode density or motion that fights glanceability. See cosmos://docs/design-pack-authoring.',
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
        'Update a user-authored design pack (name and/or content). Built-in packs are read-only and reject updates. Slug is immutable — use create_design to fork. A design pack supplements the wall-display principles (cosmos://docs/wall-display-principles) — it must not encode density or motion that fights glanceability. See cosmos://docs/design-pack-authoring.',
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

    {
      name: 'delete_scene',
      description:
        '⚠️ DESTRUCTIVE — permanently removes a scene and all its widgets. Cannot be undone. Any display rotation referencing this scene is cleaned up automatically; if a display has it set as default or current, that pointer is cleared. ONLY call after the user has explicitly asked to delete the scene by name. Well-behaved MCP clients should surface a confirm prompt — treat as if they will not.',
      inputSchema: z.object({ id: z.string().describe('Scene id from list_scenes.') }),
      confirmRequired: true,
      execute: async (raw) => {
        const args = raw as { id: string };
        const r = await inject(app, { method: 'DELETE', url: `/api/scenes/${encodeURIComponent(args.id)}` });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult({ ok: true, deletedId: args.id });
      },
    },

    {
      name: 'delete_widget',
      description:
        '⚠️ DESTRUCTIVE — removes a single widget from its parent scene. Cannot be undone. The scene itself is preserved. ONLY call after the user has explicitly asked to delete the widget. Well-behaved MCP clients should surface a confirm prompt — treat as if they will not.',
      inputSchema: z.object({ id: z.string().describe('Widget id from list_widgets.') }),
      confirmRequired: true,
      execute: async (raw) => {
        const args = raw as { id: string };
        const r = await inject(app, { method: 'DELETE', url: `/api/widgets/${encodeURIComponent(args.id)}` });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'activate_scene',
      description:
        '⚠️ STATE-CHANGING — pushes a scene LIVE to a wall display. Whatever is currently on screen transitions out. Reversible (call again with a different sceneId), but visible to anyone in the room. ONLY call after the user has explicitly asked to "show", "activate", or "switch to" a scene on a specific display — well-behaved MCP clients will surface a confirm prompt for you, but treat it as if they will not. Optional `transitionId`: pass null to use the scene\'s default; pass a transition id from `list_transitions` to override for this one activation.',
      inputSchema: z.object({
        displayName: z.string().describe('The display name from list_displays.'),
        sceneId: z.string().describe('The scene id from list_scenes.'),
        transitionId: z.string().nullable().optional(),
      }),
      confirmRequired: true,
      execute: async (raw) => {
        const args = raw as { displayName: string; sceneId: string; transitionId?: string | null };
        const r = await inject(app, {
          method: 'POST',
          url: `/api/displays/${encodeURIComponent(args.displayName)}/scene/activate`,
          payload: {
            sceneId: args.sceneId,
            ...(args.transitionId !== undefined ? { transitionId: args.transitionId } : {}),
          } as import('light-my-request').InjectPayload,
        });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },
  ];
}
