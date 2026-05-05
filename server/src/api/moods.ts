import type { FastifyInstance } from 'fastify';
import { scanMoodsDir } from '../moods/scan.js';

export type MoodRoutesDeps = {
  /** Returns the absolute path to the directory containing mood videos, or null. */
  moodsDir: () => string | null;
};

export function registerMoodRoutes(app: FastifyInstance, deps: MoodRoutesDeps): void {
  app.get('/api/moods', async () => {
    const entries = scanMoodsDir(deps.moodsDir());
    return entries.map((m) => ({ id: m.id, label: m.label, tags: m.tags }));
  });
}
