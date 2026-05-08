import Fastify, { type FastifyInstance } from 'fastify';
import type { DisplaysRepo } from '../store/displays.js';
import type { SettingsRepo } from '../store/settings.js';
import {
  readCanvasFetchPolicy,
  writeCanvasFetchPolicy,
  normalizeCanvasFetchPolicy,
  type CanvasFetchPolicy,
} from '../store/canvasFetch.js';
import type { ScenesRepo } from '../store/scenes.js';
import type { TransitionsRepo, OverridesRepo } from '../store/transitions.js';
import { registerSceneRoutes } from './scenes.js';
import { registerTransitionRoutes } from './transitions.js';
import { registerHaEntityRoutes } from './ha-entities.js';
import { registerHaMediaProxyRoutes } from './ha-media-proxy.js';
import { registerMoodRoutes } from './moods.js';
import { registerCanvasRoutes, createCanvasExtrasStore, type CanvasExtrasStore } from './canvases.js';
import { registerDocsRoutes } from './docs.js';
import { registerAgentRoutes } from './agent.js';
import { registerMcpRoutes } from './mcp.js';
import type { AlertManager } from '../scenes/alerts.js';
import type { DisplayPaletteStore } from '../store/displayPalette.js';

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

/** Global multiplier applied to every transition's `out` and `in` durations
 *  before the descriptor is sent to the display. 1.0 = baked-in builtin
 *  durations; <1 = faster; >1 = slower. Clamped so a typo can't freeze the
 *  display for minutes. */
export const DEFAULT_TRANSITION_SPEED = 1.0;
export const MIN_TRANSITION_SPEED = 0.25;
export const MAX_TRANSITION_SPEED = 5.0;
export function readTransitionSpeed(settings: SettingsRepo): number {
  const raw = settings.get('transition_speed_multiplier');
  if (!raw) return DEFAULT_TRANSITION_SPEED;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TRANSITION_SPEED;
  return Math.min(MAX_TRANSITION_SPEED, Math.max(MIN_TRANSITION_SPEED, n));
}

export type HttpDeps = {
  displays: DisplaysRepo;
  settings: SettingsRepo;
  scenes: ScenesRepo;
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
  haClient?: import('../ha/types.js').HaClient | null;
  /** Server-reachable HA URL for the media proxy (LAN URL or `http://supervisor/core`). */
  haUrl?: string | null;
  /** HA token (long-lived or Supervisor) for authenticated proxy fetches. */
  haToken?: string | null;
  moodsDir?: () => string | null;
  onSceneChanged?: (
    displayId: string,
    opts?: { skipHistory?: boolean; explicitTransitionId?: string | null }
  ) => void;
  onSettingsChanged?: () => void;
  onRotationChanged?: (displayId: string) => void;
  onDisplayConfigChanged?: (displayId: string) => void;
  onScenesListChanged?: () => void;
  /** Fired after any successful scene OR widget mutation. The host wires
   *  this to GC the canvas resolver — without it, removed canvas widgets
   *  leave their HA template subscriptions registered forever. */
  onScenesMutated?: () => void;
  onDisplayDeleted?: (displayId: string, name: string) => void;
  canvasExtras?: CanvasExtrasStore;
  onCanvasExtrasChanged?: (displayName: string) => void;
  /** Server-side alert timer manager. When provided, the scene-alert endpoint
   *  is registered. Manual scene activations also cancel any active alert. */
  alerts?: AlertManager;
  /** Absolute path to the bundled `docs/` directory. When provided, the
   *  `/api/docs` and `/api/docs/:slug` routes are registered. */
  docsDir?: string;
  /** Per-display palette store for the adaptive-gradient feature. */
  displayPalette?: DisplayPaletteStore;
  /** Fired by the palette POST endpoint when the resolved set actually
   *  changed for a display. The host wires this to a per-display scene
   *  re-push so the new gradient.colors land on the wall. */
  onPaletteChanged?: (displayId: string) => void;
};

export async function buildHttpApp(deps: HttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Accept text/plain and text/html bodies (the canvas-content shortcut at
  // PUT /api/widgets/:id/content lets agents POST raw HTML without JSON
  // wrapping). Cap at 256KB so a wedged client can't blow up memory.
  app.addContentTypeParser(/^text\/(plain|html|markdown).*/, { parseAs: 'string', bodyLimit: 256 * 1024 }, (_req, body, done) => {
    done(null, body);
  });

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

  app.get('/api/settings/transition-speed', async () => ({
    multiplier: readTransitionSpeed(deps.settings),
    min: MIN_TRANSITION_SPEED,
    max: MAX_TRANSITION_SPEED,
    default: DEFAULT_TRANSITION_SPEED,
  }));
  app.put<{ Body: { multiplier?: unknown } }>('/api/settings/transition-speed', async (req, reply) => {
    const n = Number(req.body?.multiplier);
    if (!Number.isFinite(n) || n < MIN_TRANSITION_SPEED || n > MAX_TRANSITION_SPEED) {
      return reply.code(400).send({
        error: `multiplier must be a number between ${MIN_TRANSITION_SPEED} and ${MAX_TRANSITION_SPEED}`,
      });
    }
    deps.settings.set('transition_speed_multiplier', String(n));
    deps.onSettingsChanged?.();
    return { multiplier: n };
  });

  app.get('/api/settings/canvas-fetch', async () => readCanvasFetchPolicy(deps.settings));
  app.put<{ Body: unknown }>('/api/settings/canvas-fetch', async (req, reply) => {
    // Defensive: the body must be a JSON object with a recognizable shape.
    // normalizeCanvasFetchPolicy is tolerant of extras but a non-object body
    // (string, array, null) is almost certainly a client mistake.
    const body = req.body as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: 'body must be a JSON object' });
    }
    const incoming = body as Partial<CanvasFetchPolicy>;
    if (incoming.mode !== undefined && incoming.mode !== 'off' && incoming.mode !== 'allowlist' && incoming.mode !== 'any') {
      return reply.code(400).send({ error: 'mode must be off | allowlist | any' });
    }
    const merged = { ...readCanvasFetchPolicy(deps.settings), ...normalizeCanvasFetchPolicy(incoming) };
    const stored = writeCanvasFetchPolicy(deps.settings, merged);
    deps.onSettingsChanged?.();
    return stored;
  });

  app.get<{ Params: { name: string } }>('/api/displays/:name/palette', async (req, reply) => {
    const display = deps.displays.getByName(req.params.name);
    if (!display) return reply.code(404).send({ error: 'display not found' });
    const result = deps.displayPalette?.getResolved(display.id) ?? { colors: [], updatedAt: null };
    return result;
  });

  app.post<{
    Params: { name: string };
    Body: { widgetId?: unknown; colors?: unknown };
  }>('/api/displays/:name/palette', async (req, reply) => {
    const display = deps.displays.getByName(req.params.name);
    if (!display) return reply.code(404).send({ error: 'display not found' });
    const widgetId = typeof req.body?.widgetId === 'string' ? req.body.widgetId : '';
    if (!widgetId) return reply.code(400).send({ error: 'widgetId is required' });
    const raw = req.body?.colors;
    if (!Array.isArray(raw)) return reply.code(400).send({ error: 'colors must be an array' });
    if (raw.length > 5) return reply.code(400).send({ error: 'colors must contain at most 5 entries' });
    const colors: string[] = [];
    for (const c of raw) {
      if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) {
        return reply.code(400).send({ error: 'each color must be a #rrggbb string' });
      }
      colors.push(c.toLowerCase());
    }
    const result = deps.displayPalette?.set(display.id, widgetId, colors);
    if (result?.resolvedChanged) deps.onPaletteChanged?.(display.id);
    return reply.code(204).send();
  });

  registerTransitionRoutes(app, deps.transitions);

  registerHaEntityRoutes(app, { haClient: deps.haClient ?? null });
  registerHaMediaProxyRoutes(app, { haUrl: deps.haUrl ?? null, haToken: deps.haToken ?? null });
  registerMoodRoutes(app, { moodsDir: () => deps.moodsDir?.() ?? null });

  registerSceneRoutes(app, {
    scenes: deps.scenes,
    displays: deps.displays,
    transitions: deps.transitions,
    onSceneChanged: deps.onSceneChanged,
    onRotationChanged: deps.onRotationChanged,
    onDisplayConfigChanged: deps.onDisplayConfigChanged,
    onScenesListChanged: deps.onScenesListChanged,
    onScenesMutated: deps.onScenesMutated,
    onDisplayDeleted: deps.onDisplayDeleted,
    alerts: deps.alerts,
  });

  if (deps.canvasExtras) {
    registerCanvasRoutes(app, {
      extras: deps.canvasExtras,
      onExtrasChanged: deps.onCanvasExtrasChanged,
    });
  }

  if (deps.docsDir) {
    registerDocsRoutes(app, { docsDir: deps.docsDir, haClient: deps.haClient ?? null });
  }

  // Agent routes register unconditionally — settings GET/PUT and "key not set"
  // 503 work even when no docs are bundled. The system-prompt builder
  // gracefully handles a missing docs directory.
  registerAgentRoutes(app, {
    app,
    settings: deps.settings,
    haClient: deps.haClient ?? null,
    docsDir: deps.docsDir ?? '',
  });

  registerMcpRoutes(app, {
    app,
    settings: deps.settings,
    haClient: deps.haClient ?? null,
    docsDir: deps.docsDir ?? '',
  });

  return app;
}
