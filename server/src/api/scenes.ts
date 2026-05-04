import type { FastifyInstance } from 'fastify';
import type { ScenesRepo, SceneInput } from '../store/scenes.js';
import type { DisplaysRepo } from '../store/displays.js';

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

export type SceneRoutesDeps = {
  scenes: ScenesRepo;
  displays: DisplaysRepo;
  onSceneChanged?: (displayId: string, opts?: { explicitTransitionId?: string | null }) => void;
};

export function registerSceneRoutes(app: FastifyInstance, deps: SceneRoutesDeps): void {
  app.post('/api/scenes', async (req, reply) => {
    if (!isValidSceneInput(req.body)) {
      return reply.code(400).send({ error: 'invalid scene payload' });
    }
    return deps.scenes.create(req.body);
  });

  app.get('/api/scenes', async () => deps.scenes.list());

  app.get<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const scene = deps.scenes.get(req.params.id);
    if (!scene) return reply.code(404).send({ error: 'not found' });
    return scene;
  });

  app.put<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    if (!isValidSceneInput(req.body)) {
      return reply.code(400).send({ error: 'invalid scene payload' });
    }
    const existing = deps.scenes.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const updated = deps.scenes.update(req.params.id, req.body);
    notifyAffectedDisplays(req.params.id, deps);
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const existing = deps.scenes.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    deps.scenes.delete(req.params.id);
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
      deps.displays.setCurrentScene(display.id, sceneId);
      deps.onSceneChanged?.(display.id, { explicitTransitionId: transitionId });
      return deps.displays.getById(display.id);
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
