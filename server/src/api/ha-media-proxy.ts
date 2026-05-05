import type { FastifyInstance } from 'fastify';

/**
 * Forwards `GET /api/ha-media/<path>?<query>` to the configured HA host,
 * streaming back album art / camera snapshots / any other binary asset HA
 * exposes. Solves the "media art 404s" problem for both setups:
 *
 *   - **Direct HA**:  HA_URL set (e.g. http://homeassistant.local:8123).
 *   - **Add-on**:     SUPERVISOR_TOKEN set; HA URL is the Supervisor-only
 *                     `http://supervisor/core`, which the browser cannot
 *                     reach but the server can.
 *
 * Without this proxy the browser would resolve `entity_picture` paths
 * (`/api/media_player_proxy/...`) against Cosmos's own origin and 404.
 */
export type HaMediaProxyDeps = {
  /** Resolved HA base URL, server-reachable. Null when no HA is configured. */
  haUrl: string | null;
  /** Auth token used when fetching from HA. */
  haToken: string | null;
};

export function registerHaMediaProxyRoutes(app: FastifyInstance, deps: HaMediaProxyDeps): void {
  app.get<{ Params: { '*': string } }>('/api/ha-media/*', async (req, reply) => {
    if (!deps.haUrl) {
      return reply.code(503).send({ error: 'HA not configured' });
    }

    // The path captured after /api/ha-media/, plus the original query string.
    const path = req.params['*'] ?? '';
    const qIdx = req.url.indexOf('?');
    const queryStr = qIdx >= 0 ? req.url.substring(qIdx) : '';
    const target = `${deps.haUrl.replace(/\/+$/, '')}/${path}${queryStr}`;

    try {
      const upstream = await fetch(target, {
        headers: deps.haToken ? { Authorization: `Bearer ${deps.haToken}` } : {},
      });
      if (!upstream.ok) {
        return reply.code(upstream.status).send();
      }

      // Forward useful content headers.
      const ct = upstream.headers.get('content-type');
      if (ct) reply.header('content-type', ct);
      const cl = upstream.headers.get('content-length');
      if (cl) reply.header('content-length', cl);
      // Album art changes rarely; let the browser cache for a few minutes.
      reply.header('cache-control', 'private, max-age=300');

      const buf = Buffer.from(await upstream.arrayBuffer());
      return reply.send(buf);
    } catch (err) {
      console.error(`ha-media proxy failed for ${path}`, err);
      return reply.code(502).send({ error: 'upstream fetch failed' });
    }
  });
}
