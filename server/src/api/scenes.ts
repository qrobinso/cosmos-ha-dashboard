import type { FastifyInstance } from 'fastify';
import type { ScenesRepo, SceneInput } from '../store/scenes.js';
import type { DisplaysRepo } from '../store/displays.js';
import type { TransitionsRepo } from '../store/transitions.js';
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
  onSceneChanged?: (displayId: string, opts?: { explicitTransitionId?: string | null }) => void;
  onRotationChanged?: (displayId: string) => void;
  onDisplayConfigChanged?: (displayId: string) => void;
  /** Fired when a scene is created, renamed, or deleted — used to
   *  refresh MQTT discovery's scene-select options list. */
  onScenesListChanged?: () => void;
  /** Fired when a display is deleted, with the display id + name. Used
   *  to drop in-memory state, MQTT discovery entries, and rotation timers. */
  onDisplayDeleted?: (displayId: string, name: string) => void;
};

export function registerSceneRoutes(app: FastifyInstance, deps: SceneRoutesDeps): void {
  app.post('/api/scenes', async (req, reply) => {
    const v = validateSceneInput(req.body);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    const created = deps.scenes.create(v.value);
    deps.onScenesListChanged?.();
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
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const existing = deps.scenes.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    deps.scenes.delete(req.params.id);
    deps.onScenesListChanged?.();
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
      deps.displays.setCurrentScene(display.id, sceneId);
      deps.onSceneChanged?.(display.id, { explicitTransitionId: transitionId });
      return deps.displays.getById(display.id);
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
}

function notifyAffectedDisplays(sceneId: string, deps: SceneRoutesDeps): void {
  if (!deps.onSceneChanged) return;
  for (const d of deps.displays.list()) {
    if (d.currentSceneId === sceneId || d.defaultSceneId === sceneId) {
      deps.onSceneChanged(d.id);
    }
  }
}
