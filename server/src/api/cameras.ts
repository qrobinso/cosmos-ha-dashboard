import type { FastifyInstance } from 'fastify';
import { PassThrough } from 'node:stream';
import type { HaClient } from '../ha/types.js';

export type CameraRoutesDeps = {
  haClient: HaClient | null;
};

function proxyHaPath(url: string): string {
  if (!url) return '';
  if (url.startsWith('/')) return '/api/ha-media' + url;
  return url;
}

function validCameraEntity(entityId: string): boolean {
  return /^camera\.[A-Za-z0-9_]+$/.test(entityId);
}

export function registerCameraRoutes(app: FastifyInstance, deps: CameraRoutesDeps): void {
  app.get<{ Params: { entityId: string } }>('/api/cameras/:entityId/capabilities', async (req, reply) => {
    const entityId = req.params.entityId;
    if (!validCameraEntity(entityId)) return reply.code(400).send({ error: 'invalid camera entity id' });
    if (!deps.haClient) return { frontend_stream_types: [] };
    return deps.haClient.getCameraCapabilities(entityId);
  });

  app.get<{ Params: { entityId: string }; Querystring: { format?: string } }>(
    '/api/cameras/:entityId/stream-url',
    async (req, reply) => {
      const entityId = req.params.entityId;
      if (!validCameraEntity(entityId)) return reply.code(400).send({ error: 'invalid camera entity id' });
      if (!deps.haClient) return reply.code(503).send({ error: 'Home Assistant is not connected' });
      const format = req.query.format === 'hls' ? 'hls' : undefined;
      const stream = await deps.haClient.getCameraStream(entityId, format);
      if (!stream.url) return reply.code(404).send({ error: 'stream unavailable' });
      return { url: proxyHaPath(stream.url) };
    }
  );

  app.get<{ Params: { entityId: string } }>(
    '/api/cameras/:entityId/webrtc/client-config',
    async (req, reply) => {
      const entityId = req.params.entityId;
      if (!validCameraEntity(entityId)) return reply.code(400).send({ error: 'invalid camera entity id' });
      if (!deps.haClient) return reply.code(503).send({ error: 'Home Assistant is not connected' });
      return deps.haClient.getCameraWebRtcClientConfig(entityId);
    }
  );

  app.post<{
    Params: { entityId: string };
    Body: { session_id?: unknown; candidate?: unknown };
  }>('/api/cameras/:entityId/webrtc/candidate', async (req, reply) => {
    const entityId = req.params.entityId;
    if (!validCameraEntity(entityId)) return reply.code(400).send({ error: 'invalid camera entity id' });
    if (!deps.haClient) return reply.code(503).send({ error: 'Home Assistant is not connected' });
    const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id : '';
    const candidate = req.body?.candidate;
    if (!sessionId) return reply.code(400).send({ error: 'session_id is required' });
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return reply.code(400).send({ error: 'candidate must be an object' });
    }
    await deps.haClient.addCameraWebRtcCandidate(entityId, sessionId, candidate as Record<string, unknown>);
    return reply.code(204).send();
  });

  app.post<{
    Params: { entityId: string };
    Body: { offer?: unknown };
  }>('/api/cameras/:entityId/webrtc/offer', async (req, reply) => {
    const entityId = req.params.entityId;
    if (!validCameraEntity(entityId)) return reply.code(400).send({ error: 'invalid camera entity id' });
    if (!deps.haClient) return reply.code(503).send({ error: 'Home Assistant is not connected' });
    const offer = typeof req.body?.offer === 'string' ? req.body.offer : '';
    if (!offer) return reply.code(400).send({ error: 'offer is required' });

    const out = new PassThrough();
    reply.header('content-type', 'application/x-ndjson');
    reply.header('cache-control', 'no-store');

    let unsubscribe: (() => void) | null = null;
    reply.raw.on('close', () => {
      unsubscribe?.();
      out.destroy();
    });

    deps.haClient
      .subscribeCameraWebRtcOffer(entityId, offer, (event) => {
        out.write(JSON.stringify(event) + '\n');
      })
      .then((unsub) => {
        unsubscribe = unsub;
      })
      .catch((err) => {
        out.write(JSON.stringify({
          type: 'error',
          code: 'subscribe_failed',
          message: err instanceof Error ? err.message : String(err),
        }) + '\n');
        out.end();
      });

    return reply.send(out);
  });
}
