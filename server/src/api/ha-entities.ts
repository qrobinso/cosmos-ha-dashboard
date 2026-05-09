import type { FastifyInstance } from 'fastify';
import type { HaClient, EntityState } from '../ha/types.js';
import { MOCK_ENTITIES } from '../scenes/mockData.js';

export type HaEntitiesDeps = {
  haClient: HaClient | null;
};

export function registerHaEntityRoutes(app: FastifyInstance, deps: HaEntitiesDeps): void {
  /** GET /api/ha/entities — filtered listing.
   *
   *  Query params (all optional, AND-combined):
   *  - `domain`        — exact domain prefix match (e.g. `sensor` matches `sensor.*`)
   *  - `device_class`  — match against `attributes.device_class`
   *  - `search`        — case-insensitive substring matched against
   *                      `entity_id` and `attributes.friendly_name`
   *  - `limit`         — cap the result count (default unlimited)
   *
   *  Designed for agents that have thousands of entities to navigate —
   *  `domain=sensor&search=kitchen` reliably narrows to a handful of hits
   *  without the agent having to slurp the full catalog. */
  app.get<{
    Querystring: { domain?: string; device_class?: string; search?: string; limit?: string };
  }>('/api/ha/entities', async (req) => {
    let out = collectEntities(deps.haClient);
    const { domain, device_class, search, limit } = req.query;
    if (domain) out = out.filter((e) => e.entity_id.startsWith(`${domain}.`));
    if (device_class) {
      out = out.filter((e) => {
        const a = (e.attributes ?? {}) as Record<string, unknown>;
        return a.device_class === device_class;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((e) => {
        if (e.entity_id.toLowerCase().includes(q)) return true;
        const a = (e.attributes ?? {}) as Record<string, unknown>;
        const fn = typeof a.friendly_name === 'string' ? a.friendly_name.toLowerCase() : '';
        return fn.includes(q);
      });
    }
    const n = limit ? Number.parseInt(limit, 10) : NaN;
    if (Number.isFinite(n) && n > 0) out = out.slice(0, n);
    return out;
  });

  /** GET /api/ha/entities/summary — orientation snapshot.
   *
   *  Returns `{total, domains: {sensor: 412, light: 38, ...}, deviceClasses: {temperature: 14, ...}}`.
   *  Tiny payload (~hundreds of bytes typical) so a fresh agent can pull
   *  it without bloating context, then narrow with the filtered list. */
  app.get('/api/ha/entities/summary', async () => {
    const all = collectEntities(deps.haClient);
    const domains: Record<string, number> = {};
    const deviceClasses: Record<string, number> = {};
    for (const e of all) {
      const dot = e.entity_id.indexOf('.');
      if (dot > 0) {
        const d = e.entity_id.slice(0, dot);
        domains[d] = (domains[d] ?? 0) + 1;
      }
      const a = (e.attributes ?? {}) as Record<string, unknown>;
      if (typeof a.device_class === 'string') {
        deviceClasses[a.device_class] = (deviceClasses[a.device_class] ?? 0) + 1;
      }
    }
    return { total: all.length, domains, deviceClasses };
  });
}

function collectEntities(haClient: HaClient | null): EntityState[] {
  if (!haClient) return Object.values(MOCK_ENTITIES);
  return haClient.listEntities();
}
