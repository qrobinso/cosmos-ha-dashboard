import type { FastifyInstance } from 'fastify';
import type { ScenesRepo, SceneInput } from '../store/scenes.js';
import type { DisplaysRepo } from '../store/displays.js';
import type { TransitionsRepo } from '../store/transitions.js';
import type { AlertManager } from '../scenes/alerts.js';
function validateMood(mood: unknown): string | null {
  if (mood === undefined) return null;
  if (typeof mood !== 'object' || mood === null) return 'mood must be an object';
  const m = mood as Record<string, unknown>;
  if (typeof m.enabled !== 'boolean') return 'mood.enabled must be boolean';
  if (m.strategy !== 'manual' && m.strategy !== 'time' && m.strategy !== 'weather') {
    return 'mood.strategy must be manual, time, or weather';
  }
  if (m.strategy === 'manual' && m.enabled) {
    if (typeof m.moodId !== 'string' || m.moodId.trim() === '' || /[\\/]/.test(m.moodId)) {
      return 'mood.moodId must be a non-empty string without slashes';
    }
  }
  if (m.strategy === 'weather' && m.enabled) {
    if (typeof m.weatherEntity !== 'string' || !m.weatherEntity.startsWith('weather.')) {
      return 'mood.weatherEntity must be a weather.* entity id';
    }
  }
  if (m.opacity !== undefined) {
    if (typeof m.opacity !== 'number' || !Number.isFinite(m.opacity) || m.opacity < 0 || m.opacity > 1) {
      return 'mood.opacity must be a number between 0 and 1';
    }
  }
  return null;
}

function validateSceneInput(body: unknown): { ok: true; value: SceneInput } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'invalid scene payload' };
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || b.name.trim() === '') return { ok: false, error: 'invalid scene payload' };
  if (typeof b.layout !== 'object' || b.layout === null) return { ok: false, error: 'invalid scene payload' };
  if (typeof b.background !== 'object' || b.background === null) return { ok: false, error: 'invalid scene payload' };
  if (typeof b.typography !== 'object' || b.typography === null) return { ok: false, error: 'invalid scene payload' };
  if (!Array.isArray(b.widgets)) return { ok: false, error: 'invalid scene payload' };
  const moodErr = validateMood(b.mood);
  if (moodErr) return { ok: false, error: moodErr };
  return { ok: true, value: b as unknown as SceneInput };
}

export type SceneRoutesDeps = {
  scenes: ScenesRepo;
  displays: DisplaysRepo;
  transitions: TransitionsRepo;
  onSceneChanged?: (
    displayId: string,
    opts?: { skipHistory?: boolean; explicitTransitionId?: string | null }
  ) => void;
  onRotationChanged?: (displayId: string) => void;
  onDisplayConfigChanged?: (displayId: string) => void;
  /** Fired when a scene is created, renamed, or deleted — used to
   *  refresh MQTT discovery's scene-select options list. */
  onScenesListChanged?: () => void;
  /** Fired after any successful scene OR widget mutation (create, full
   *  update, delete, widget patch, widget content update). The host uses
   *  this to GC the canvas resolver — without it, subscriptions for
   *  removed canvas widgets keep firing entity-update callbacks forever. */
  onScenesMutated?: () => void;
  /** Fired when a display is deleted, with the display id + name. Used
   *  to drop in-memory state, MQTT discovery entries, and rotation timers. */
  onDisplayDeleted?: (displayId: string, name: string) => void;
  /** Server-side alert timer manager. Manual /scene/activate cancels any
   *  active alert before mutating state. */
  alerts?: AlertManager;
};

export function registerSceneRoutes(app: FastifyInstance, deps: SceneRoutesDeps): void {
  app.post('/api/scenes', async (req, reply) => {
    const v = validateSceneInput(req.body);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    const created = deps.scenes.create(v.value);
    deps.onScenesListChanged?.();
    deps.onScenesMutated?.();
    return created;
  });

  app.get('/api/scenes', async () => deps.scenes.list());

  app.get<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const scene = deps.scenes.get(req.params.id);
    if (!scene) return reply.code(404).send({ error: 'not found' });
    return scene;
  });

  app.put<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const v = validateSceneInput(req.body);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    const existing = deps.scenes.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const updated = deps.scenes.update(req.params.id, v.value);
    notifyAffectedDisplays(req.params.id, deps);
    if (existing.name !== updated.name) deps.onScenesListChanged?.();
    deps.onScenesMutated?.();
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const existing = deps.scenes.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    deps.scenes.delete(req.params.id);
    deps.onScenesListChanged?.();
    deps.onScenesMutated?.();
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
      if (transitionId !== null && deps.transitions.getById(transitionId) === null) {
        return reply.code(404).send({ error: 'transition not found' });
      }
      deps.alerts?.cancel(display.id);
      deps.displays.setCurrentScene(display.id, sceneId);
      deps.onSceneChanged?.(display.id, { explicitTransitionId: transitionId });
      return deps.displays.getById(display.id);
    }
  );

  app.post<{
    Params: { name: string };
    Body: { sceneId?: unknown; dwellMs?: unknown; transitionId?: unknown };
  }>(
    '/api/displays/:name/scene/alert',
    async (req, reply) => {
      if (!deps.alerts) return reply.code(503).send({ error: 'alerts not configured' });
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const sceneId = typeof req.body?.sceneId === 'string' ? req.body.sceneId : null;
      if (!sceneId) return reply.code(400).send({ error: 'sceneId required' });
      const dwellMs = req.body?.dwellMs;
      if (typeof dwellMs !== 'number' || !Number.isFinite(dwellMs) || dwellMs <= 0) {
        return reply.code(400).send({ error: 'dwellMs must be a positive number (ms)' });
      }
      const scene = deps.scenes.get(sceneId);
      if (!scene) return reply.code(404).send({ error: 'scene not found' });
      const transitionId =
        typeof req.body?.transitionId === 'string' ? req.body.transitionId : null;
      if (transitionId !== null && deps.transitions.getById(transitionId) === null) {
        return reply.code(404).send({ error: 'transition not found' });
      }
      deps.alerts.fire(display.id, sceneId, dwellMs, { explicitTransitionId: transitionId });
      return { ok: true, displayId: display.id, sceneId, dwellMs };
    }
  );

  app.put<{
    Params: { name: string };
    Body: { enabled?: unknown; sceneIds?: unknown; intervalSec?: unknown };
  }>(
    '/api/displays/:name/rotation',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const enabled = req.body?.enabled === true;
      const sceneIds = Array.isArray(req.body?.sceneIds)
        ? req.body!.sceneIds.filter((x): x is string => typeof x === 'string')
        : [];
      const intervalSec =
        typeof req.body?.intervalSec === 'number' && req.body.intervalSec >= 5
          ? req.body.intervalSec
          : 60;
      if (enabled && sceneIds.length === 0) {
        return reply.code(400).send({ error: 'sceneIds must be non-empty when enabled' });
      }
      for (const sid of sceneIds) {
        if (!deps.scenes.get(sid)) {
          return reply.code(404).send({ error: `scene ${sid} not found` });
        }
      }
      deps.displays.setRotation(display.id, { enabled, sceneIds, intervalSec });
      deps.onRotationChanged?.(display.id);
      return deps.displays.getById(display.id);
    }
  );

  app.put<{
    Params: { name: string };
    Body: { orientation?: unknown };
  }>(
    '/api/displays/:name/orientation',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const orientation = req.body?.orientation;
      if (orientation !== 'landscape' && orientation !== 'portrait') {
        return reply.code(400).send({ error: 'orientation must be landscape or portrait' });
      }
      deps.displays.setOrientation(display.id, orientation);
      deps.onDisplayConfigChanged?.(display.id);
      return deps.displays.getById(display.id);
    }
  );

  app.delete<{ Params: { name: string } }>(
    '/api/displays/:name',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const id = display.id;
      const name = display.name;
      // Stop rotation, drop in-memory state, clear MQTT discovery — all
      // wired up by the host through onDisplayDeleted.
      deps.onDisplayDeleted?.(id, name);
      deps.displays.delete(id);
      return reply.code(204).send();
    }
  );

  // ── Per-widget endpoints ─────────────────────────────────────────────
  //
  // Designed for LLM agents updating canvas widgets in place. The
  // alternative — GET /api/scenes/:id, mutate the widget, PUT the whole
  // scene — forces an agent to round-trip the entire scene (which can be
  // tens of KB of HTML) just to change one field.

  /** GET /api/widgets — flat list of every widget across every scene, with
   *  the parent scene's id + name so an agent can locate "the canvas widget
   *  on the Kitchen scene" without fetching scenes one-by-one. Filters:
   *  `?scene=<id-or-name>` and `?kind=<kind>`. */
  app.get<{ Querystring: { scene?: string; kind?: string } }>(
    '/api/widgets',
    async (req) => {
      const sceneFilter = typeof req.query?.scene === 'string' ? req.query.scene : null;
      const kindFilter = typeof req.query?.kind === 'string' ? req.query.kind : null;
      const out: Array<{
        id: string;
        sceneId: string;
        sceneName: string;
        kind: string;
        position: unknown;
        config: unknown;
      }> = [];
      for (const s of deps.scenes.list()) {
        if (sceneFilter && s.id !== sceneFilter && s.name !== sceneFilter) continue;
        for (const w of s.widgets) {
          if (kindFilter && w.kind !== kindFilter) continue;
          out.push({
            id: w.id,
            sceneId: s.id,
            sceneName: s.name,
            kind: w.kind,
            position: w.position,
            config: w.config,
          });
        }
      }
      return out;
    }
  );

  /** PATCH /api/widgets/:widgetId — partial update of a single widget.
   *  Body: `{ position?, config? }`. The `config` object is shallow-merged
   *  into the existing config (so `{config: {content: "<div>..."}}` only
   *  touches that one key); pass an empty config to clear nothing. Returns
   *  the parent scene. Re-pushes to every display using the scene. */
  app.patch<{
    Params: { widgetId: string };
    Body: { position?: unknown; config?: unknown };
  }>(
    '/api/widgets/:widgetId',
    async (req, reply) => {
      const widgetId = req.params.widgetId;
      const found = findWidgetWithScene(widgetId, deps);
      if (!found) return reply.code(404).send({ error: 'widget not found' });
      const { scene, widget, index } = found;

      const body = req.body ?? {};
      const newWidgets = scene.widgets.map((w, i) => {
        if (i !== index) return w;
        const next: typeof widget = { ...w };
        if (body.position !== undefined) {
          if (typeof body.position !== 'object' || body.position === null) {
            // Soft-fail by ignoring; we surface validation in the response below.
          } else {
            next.position = body.position as typeof widget.position;
          }
        }
        if (body.config !== undefined) {
          if (typeof body.config !== 'object' || body.config === null) {
            // Same as above.
          } else {
            // Shallow-merge; the agent passes only the keys it wants to change.
            next.config = { ...(w.config ?? {}), ...(body.config as Record<string, unknown>) };
          }
        }
        return next;
      });

      const updated = deps.scenes.update(scene.id, {
        name: scene.name,
        layout: scene.layout,
        background: scene.background,
        typography: scene.typography,
        defaultTransitionId: scene.defaultTransitionId,
        floatWidgets: scene.floatWidgets,
        mood: scene.mood,
        widgets: newWidgets.map((w) => ({ id: w.id, kind: w.kind, position: w.position, config: w.config })),
      });
      notifyAffectedDisplays(scene.id, deps);
      deps.onScenesMutated?.();
      return updated;
    }
  );

  /** PUT /api/widgets/:widgetId/content — agent-friendly shortcut for the
   *  canvas widget's most-edited field. Body is the raw new HTML (sent as
   *  text/plain or text/html). Equivalent to PATCH with
   *  `{config: {content: "..."}}` but without JSON wrapping. Rejects on
   *  non-canvas widgets so callers get an obvious 400 instead of silently
   *  pushing an unrelated string into someone else's config. */
  app.put<{ Params: { widgetId: string } }>(
    '/api/widgets/:widgetId/content',
    async (req, reply) => {
      const widgetId = req.params.widgetId;
      const found = findWidgetWithScene(widgetId, deps);
      if (!found) return reply.code(404).send({ error: 'widget not found' });
      const { scene, widget, index } = found;
      if (widget.kind !== 'canvas') {
        return reply.code(400).send({
          error: `widget is kind "${widget.kind}", not canvas; use PATCH /api/widgets/:id for other kinds`,
        });
      }
      const raw = req.body;
      const content =
        typeof raw === 'string' ? raw :
        // Fastify auto-parses JSON to objects; also accept {content: "..."}.
        (typeof raw === 'object' && raw !== null && typeof (raw as { content?: unknown }).content === 'string')
          ? (raw as { content: string }).content
          : null;
      if (content === null) {
        return reply.code(400).send({ error: 'body must be a string (HTML) or {"content": "..."}' });
      }
      const newWidgets = scene.widgets.map((w, i) =>
        i === index ? { ...w, config: { ...(w.config ?? {}), content } } : w
      );
      const updated = deps.scenes.update(scene.id, {
        name: scene.name,
        layout: scene.layout,
        background: scene.background,
        typography: scene.typography,
        defaultTransitionId: scene.defaultTransitionId,
        floatWidgets: scene.floatWidgets,
        mood: scene.mood,
        widgets: newWidgets.map((w) => ({ id: w.id, kind: w.kind, position: w.position, config: w.config })),
      });
      notifyAffectedDisplays(scene.id, deps);
      deps.onScenesMutated?.();
      return updated;
    }
  );
}

/** Find a widget by id across all scenes, returning the parent scene + index
 *  so callers can mutate one widget without re-walking. */
function findWidgetWithScene(
  widgetId: string,
  deps: SceneRoutesDeps
): { scene: ReturnType<ScenesRepo['list']>[number]; widget: ReturnType<ScenesRepo['list']>[number]['widgets'][number]; index: number } | null {
  for (const s of deps.scenes.list()) {
    const i = s.widgets.findIndex((w) => w.id === widgetId);
    if (i !== -1) return { scene: s, widget: s.widgets[i], index: i };
  }
  return null;
}

function notifyAffectedDisplays(sceneId: string, deps: SceneRoutesDeps): void {
  if (!deps.onSceneChanged) return;
  for (const d of deps.displays.list()) {
    if (d.currentSceneId === sceneId || d.defaultSceneId === sceneId) {
      deps.onSceneChanged(d.id);
    }
  }
}
