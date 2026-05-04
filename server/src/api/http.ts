import Fastify, { type FastifyInstance } from 'fastify';
import type { DisplaysRepo } from '../store/displays.js';
import type { SettingsRepo } from '../store/settings.js';
import type { ScenesRepo } from '../store/scenes.js';
import { registerSceneRoutes } from './scenes.js';

export type HttpDeps = {
  displays: DisplaysRepo;
  settings: SettingsRepo;
  scenes: ScenesRepo;
  onSceneChanged?: (displayId: string) => void;
};

export async function buildHttpApp(deps: HttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.post<{ Body: { name?: unknown } }>('/api/displays/register', async (req, reply) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      return reply.code(400).send({ error: 'name is required' });
    }
    const display = deps.displays.registerByName(name);
    return display;
  });

  app.get('/api/displays', async () => deps.displays.list());

  registerSceneRoutes(app, {
    scenes: deps.scenes,
    displays: deps.displays,
    onSceneChanged: deps.onSceneChanged,
  });

  return app;
}
