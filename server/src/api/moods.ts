import type { FastifyInstance } from 'fastify';
import { MOOD_CATALOG } from '../moods/catalog.js';

export function registerMoodRoutes(app: FastifyInstance): void {
  app.get('/api/moods', async () =>
    MOOD_CATALOG.map((m) => ({ id: m.id, label: m.label, tags: m.tags }))
  );
}
