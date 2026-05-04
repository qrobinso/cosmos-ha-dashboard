import type { FastifyInstance } from 'fastify';
import type { TransitionsRepo } from '../store/transitions.js';

export function registerTransitionRoutes(app: FastifyInstance, transitions: TransitionsRepo): void {
  app.get('/api/transitions', async () => transitions.list());

  app.get<{ Params: { id: string } }>('/api/transitions/:id', async (req, reply) => {
    const t = transitions.getById(req.params.id);
    if (!t) return reply.code(404).send({ error: 'not found' });
    return t;
  });
}
