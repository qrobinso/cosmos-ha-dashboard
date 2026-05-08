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
        const r = await inject(app, { method: 'POST', url: '/api/scenes', payload: args.payload as import('light-my-request').InjectPayload });
        if (typeof r === 'object' && r !== null && 'error' in r) return errorResult((r as { error: string }).error);
        return jsonResult(r);
      },
    },

    {
      name: 'update_scene',
      description:
        '⚠️ HEAVY — REPLACES an entire scene including every widget verbatim. Each widget object you include is stored EXACTLY as you sent it: if a widget in the payload has `config: {}` then that widget\'s previous config (e.g. canvas content) is WIPED. There is no merge, no preserve-on-omit. So in 90% of cases you should NOT use this tool. Instead: use `patch_scene` for top-level metadata (background, typography, mood, name, transition); use `patch_widget` for one widget\'s position or partial config; use `update_widget_content` for canvas HTML. Only call `update_scene` when the user wants a wholesale rewrite. If you do, first call `get_scene` to fetch current widgets verbatim and pass them through unchanged. Full SceneInput shape: `cosmos://docs/scene-agent`.',
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
        'Partial-update a scene’s metadata (background, typography, mood, name, default transition, layout, floatWidgets). Widgets are NEVER touched by this — use `patch_widget` / `update_widget_content` for those. Pass only the keys you want to change; everything you omit is preserved. Use this for "change the background to a sunrise gradient", "turn off the mood video", "rename the scene", etc. — much lighter than `update_scene`.',
      inputSchema: z.object({
        id: z.string(),
        name: z.string().optional(),
        layout: z.object({ cols: z.number(), rows: z.number(), items: z.array(z.any()).optional() }).optional(),
        background: z.any().optional().describe('Background union — {type:"solid",color} or {type:"gradient",colors,speed,style,sun_adaptive?}.'),
        typography: z.object({ font_family: z.string().optional(), font_scale: z.number().optional() }).partial().optional(),
        defaultTransitionId: z.string().nullable().optional(),
        floatWidgets: z.boolean().optional(),
        mood: z.any().optional().describe('Mood config — {enabled, strategy: manual|time|weather, moodId?, weatherEntity?, opacity?}.'),
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

    {
      name: 'activate_scene',
      description:
        '⚠️ STATE-CHANGING — pushes a scene LIVE to a wall display. Whatever is currently on screen transitions out. Reversible (call again with a different sceneId), but visible to anyone in the room. ONLY call after the user has explicitly asked to "show", "activate", or "switch to" a scene on a specific display — well-behaved MCP clients will surface a confirm prompt for you, but treat it as if they will not. Optional `transitionId`: pass null to use the scene\'s default; pass a transition id from `list_transitions` to override for this one activation.',
      inputSchema: z.object({
        displayName: z.string().describe('The display name from list_displays.'),
        sceneId: z.string().describe('The scene id from list_scenes.'),
        transitionId: z.string().nullable().optional(),
      }),
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
