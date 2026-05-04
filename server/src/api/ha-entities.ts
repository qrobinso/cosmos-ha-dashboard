import type { FastifyInstance } from 'fastify';
import type { HaClient, EntityState } from '../ha/types.js';
import { MOCK_ENTITIES } from '../scenes/mockData.js';

export type HaEntitiesDeps = {
  haClient: HaClient | null;
};

export function registerHaEntityRoutes(app: FastifyInstance, deps: HaEntitiesDeps): void {
  app.get<{ Querystring: { domain?: string } }>('/api/ha/entities', async (req) => {
    const all = collectEntities(deps.haClient);
    const filter = req.query.domain;
    if (filter) {
      return all.filter((e) => e.entity_id.startsWith(`${filter}.`));
    }
    return all;
  });
}

function collectEntities(haClient: HaClient | null): EntityState[] {
  if (!haClient) return Object.values(MOCK_ENTITIES);
  // The HaClient interface only exposes per-id getEntity, so we add a small dump method
  // by reaching for the entries the cache holds. To keep the interface narrow, we expose
  // listing only on the fake/real client implementations that wrap an EntityCache and add
  // an iterator. v1: list mocks when no HA, otherwise rely on a method on HaClient.
  // (A `list()` method on HaClient is added in this same task.)
  return haClient.listEntities();
}
