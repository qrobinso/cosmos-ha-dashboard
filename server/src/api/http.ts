import Fastify, { type FastifyInstance } from 'fastify';
import type { DisplaysRepo } from '../store/displays.js';
import type { SettingsRepo } from '../store/settings.js';

export type HttpDeps = {
  displays: DisplaysRepo;
  settings: SettingsRepo;
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

  return app;
}
