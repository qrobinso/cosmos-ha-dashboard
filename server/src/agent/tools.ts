import { tool, type CoreTool } from 'ai';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'light-my-request';
import type { HaClient } from '../ha/types.js';

export type AgentToolDeps = {
  /** The Fastify app — tool implementations route through `app.inject(...)`
   *  so the tools reuse the existing endpoints' validation + notification
   *  paths instead of re-implementing the work. */
  app: FastifyInstance;
  haClient: HaClient | null;
};

async function inject<T = unknown>(
  app: FastifyInstance,
  opts: InjectOptions
): Promise<T | { error: string; status: number }> {
  const res = await app.inject(opts);
  if (res.statusCode >= 400) {
    let message = res.payload;
    try {
      const j = JSON.parse(res.payload) as { error?: string };
      if (typeof j.error === 'string') message = j.error;
    } catch {
      // not JSON; use the raw text
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

/** Compact projections of common types so tool results don't blow the
 *  context window with config blobs the agent isn't actively editing. */
function summarizeWidget(w: { id: string; kind: string; position: unknown; config: unknown }) {
  // Trim canvas content to a preview so list_widgets doesn't dump 50KB of HTML.
  const cfg = (w.config ?? {}) as Record<string, unknown>;
  const content = typeof cfg.content === 'string' ? cfg.content : null;
  const name = typeof cfg.name === 'string' ? cfg.name : null;
  return {
    id: w.id,
    kind: w.kind,
    name,
    position: w.position,
    config: content !== null
      ? { ...cfg, content: content.length > 500 ? content.slice(0, 500) + `… (${content.length} chars)` : content }
      : cfg,
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Auto-execute tools                                                     */
/* ─────────────────────────────────────────────────────────────────────── */

export function createAutoExecuteTools(deps: AgentToolDeps): Record<string, CoreTool> {
  const { app, haClient } = deps;

  return {
    list_scenes: tool({
      description: 'List every scene with id, name, widget count, and default transition. Use this first when the user references a scene by name.',
      parameters: z.object({}),
      execute: async () => {
        const scenes = await inject<Array<{ id: string; name: string; widgets: unknown[]; defaultTransitionId: string | null }>>(app, { method: 'GET', url: '/api/scenes' });
        if ('error' in scenes) return scenes;
        return scenes.map((s) => ({
          id: s.id,
          name: s.name,
          widgetCount: Array.isArray(s.widgets) ? s.widgets.length : 0,
          defaultTransitionId: s.defaultTransitionId,
        }));
      },
    }),

    get_scene: tool({
      description: 'Fetch the full Scene object (layout, background, typography, widgets[], etc.) by id. Use only when you need to inspect or update non-widget fields; for widget tweaks use list_widgets + patch_widget instead.',
      parameters: z.object({ id: z.string().describe('The scene id from list_scenes.') }),
      execute: async ({ id }) => inject(app, { method: 'GET', url: `/api/scenes/${encodeURIComponent(id)}` }),
    }),

    create_scene: tool({
      description: 'Create a new scene. The payload follows the SceneInput shape from the SCENE AUTHORING CONTRACT — name, layout (use cols=12, rows=8, items=[]), background, typography, widgets array.',
      parameters: z.object({
        payload: z.any().describe('Full SceneInput JSON. See contract for the exact shape.'),
      }),
      execute: async ({ payload }) => inject(app, {
        method: 'POST',
        url: '/api/scenes',
        payload,
      }),
    }),

    update_scene: tool({
      description: 'Replace an entire scene with a new SceneInput payload. Heavy-handed — overwrites layout, background, typography, and ALL widgets. Prefer patch_widget / update_widget_content for incremental edits.',
      parameters: z.object({
        id: z.string(),
        payload: z.any().describe('Full SceneInput JSON.'),
      }),
      execute: async ({ id, payload }) => inject(app, {
        method: 'PUT',
        url: `/api/scenes/${encodeURIComponent(id)}`,
        payload,
      }),
    }),

    list_widgets: tool({
      description: 'Flat list of every widget across every scene, with the parent scene id+name. Filter with `scene` (id or name), `kind`, and/or `name` (matches `config.name` exactly, case-insensitively — useful when the user calls a canvas by name like "the news-headlines canvas"). Returns widget id, kind, name, position, and config (canvas content is truncated for context — fetch the full content via get_scene if you need it verbatim).',
      parameters: z.object({
        scene: z.string().optional().describe('Filter by scene id or name.'),
        kind: z.enum(['clock', 'weather', 'entity_tile', 'calendar', 'media_player', 'statistics', 'text', 'camera', 'canvas']).optional(),
        name: z.string().optional().describe('Filter by config.name (case-insensitive exact match). Best paired with kind=canvas.'),
      }),
      execute: async ({ scene, kind, name }) => {
        const qs = new URLSearchParams();
        if (scene) qs.set('scene', scene);
        if (kind) qs.set('kind', kind);
        if (name) qs.set('name', name);
        const url = qs.toString() ? `/api/widgets?${qs}` : '/api/widgets';
        const list = await inject<Array<{ id: string; sceneId: string; sceneName: string; kind: string; name: string | null; position: unknown; config: unknown }>>(app, { method: 'GET', url });
        if ('error' in list) return list;
        return list.map((w) => ({
          ...summarizeWidget(w),
          sceneId: w.sceneId,
          sceneName: w.sceneName,
        }));
      },
    }),

    patch_widget: tool({
      description: 'Partial-update a single widget by id. `config` is shallow-merged. Use this for layout tweaks, entity_id changes, etc. For canvas content specifically, prefer update_widget_content.',
      parameters: z.object({
        id: z.string(),
        position: z.object({ col: z.number(), row: z.number(), w: z.number(), h: z.number() }).optional(),
        config: z.record(z.any()).optional().describe('Partial config object — keys you include override; keys you omit are preserved.'),
      }),
      execute: async ({ id, position, config }) => inject(app, {
        method: 'PATCH',
        url: `/api/widgets/${encodeURIComponent(id)}`,
        payload: { ...(position !== undefined ? { position } : {}), ...(config !== undefined ? { config } : {}) },
      }),
    }),

    update_widget_content: tool({
      description: 'Replace the HTML content of a canvas widget by id. The shortcut for the most-edited canvas field. Returns 400 if the widget is not a canvas.',
      parameters: z.object({
        id: z.string(),
        content: z.string().describe('Full HTML body. Per the CANVAS WIDGET CONTRACT — no <html>/<body> wrapper.'),
      }),
      execute: async ({ id, content }) => inject(app, {
        method: 'PUT',
        url: `/api/widgets/${encodeURIComponent(id)}/content`,
        payload: { content },
      }),
    }),

    list_displays: tool({
      description: 'List every wall display registered with Cosmos. Returns id, name, current/default scene ids, and last-seen timestamp.',
      parameters: z.object({}),
      execute: async () => inject(app, { method: 'GET', url: '/api/displays' }),
    }),

    assign_scene_to_display: tool({
      description: 'Link a scene to a display so the display can show it. Optionally set as the default scene (loaded on display reconnect). Does NOT push the scene live — use activate_scene for that.',
      parameters: z.object({
        displayName: z.string(),
        sceneId: z.string(),
        makeDefault: z.boolean().optional(),
      }),
      execute: async ({ displayName, sceneId, makeDefault }) => inject(app, {
        method: 'POST',
        url: `/api/displays/${encodeURIComponent(displayName)}/assign-scene`,
        payload: { sceneId, makeDefault: makeDefault ?? false },
      }),
    }),

    list_ha_entities: tool({
      description: 'List Home Assistant entities currently cached. ALWAYS pass `domain` (light, sensor, weather, media_player, etc.) — the unfiltered catalog can be hundreds of entities and is rarely what you need. Only call this when an ask actually depends on knowing what entities exist; reuse earlier results in the same conversation instead of re-fetching.',
      parameters: z.object({
        domain: z.string().optional().describe("HA domain prefix, e.g. 'light' or 'sensor'."),
      }),
      execute: async ({ domain }) => {
        if (!haClient) return { error: 'Home Assistant is not connected on this Cosmos instance.' };
        const list = haClient.listEntities();
        const filtered = domain ? list.filter((e) => e.entity_id.startsWith(domain + '.')) : list;
        // Keep the response compact — agents don't need every attribute.
        return filtered.map((e) => {
          const a = (e.attributes ?? {}) as Record<string, unknown>;
          return {
            entity_id: e.entity_id,
            state: e.state,
            friendly_name: typeof a.friendly_name === 'string' ? a.friendly_name : null,
            unit: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : null,
            device_class: typeof a.device_class === 'string' ? a.device_class : null,
          };
        });
      },
    }),

    list_transitions: tool({
      description: 'List the available scene-transition descriptors. Use the returned id as `defaultTransitionId` in a SceneInput payload.',
      parameters: z.object({}),
      execute: async () => inject(app, { method: 'GET', url: '/api/transitions' }),
    }),
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Confirm-required tools (no server-side execute)                        */
/* ─────────────────────────────────────────────────────────────────────── */

/** These tools have no server-side `execute`. The model's tool call streams
 *  to the browser; the chat UI renders a confirm/reject card and triggers
 *  the underlying side effect (DELETE/POST) directly from the client when
 *  the user confirms. The result the client posts back via addToolResult
 *  carries `{ confirmed: boolean, ok?: boolean }` so the model knows what
 *  happened on the next round. */
export function createConfirmRequiredTools(): Record<string, CoreTool> {
  return {
    activate_scene: tool({
      description: 'PUSH a scene live to a wall display, transitioning from whatever is currently shown. The user will be asked to confirm before this lands. Only call after the user has explicitly asked to "show", "activate", or "switch to" a scene.',
      parameters: z.object({
        displayName: z.string(),
        sceneId: z.string(),
      }),
      // No execute — the client handles confirmation + side effect.
    }),

    delete_scene: tool({
      description: 'DELETE a scene by id. Irreversible. The user will be asked to confirm. Only call after the user has explicitly asked to delete that scene.',
      parameters: z.object({ id: z.string() }),
    }),

    delete_widget: tool({
      description: 'DELETE a widget by id from its parent scene. Irreversible. The user will be asked to confirm. Only call after the user has explicitly asked to remove that widget.',
      parameters: z.object({ id: z.string() }),
    }),
  };
}

/** Convenience: full set of tools for streamText. Spread this into the
 *  `tools` arg. */
export function createAgentTools(deps: AgentToolDeps): Record<string, CoreTool> {
  return {
    ...createAutoExecuteTools(deps),
    ...createConfirmRequiredTools(),
  };
}

/** Tool names the client must treat as confirm-required (render a confirm
 *  card, run the side effect, then call addToolResult). Exposed so the
 *  client and server stay in sync without duplicating the list. */
export const CONFIRM_REQUIRED_TOOLS = ['activate_scene', 'delete_scene', 'delete_widget'] as const;
export type ConfirmRequiredTool = (typeof CONFIRM_REQUIRED_TOOLS)[number];
