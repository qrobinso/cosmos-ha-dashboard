import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import type { MusicVideoCache } from '../musicvideo/cache.js';
import type { VideoLookup } from '../musicvideo/types.js';

/** YouTube ids are 11 chars of [A-Za-z0-9_-]; be strict, this reaches fetch(). */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{3,20}$/;

export type MusicVideoRouteDeps = {
  cache: MusicVideoCache | null;
  lookup: VideoLookup | null;
  /** Injected by tests. */
  fetchImpl?: typeof fetch;
};

/**
 * Proxies the YouTube progressive stream to the kiosk.
 *
 * The display never sees a googlevideo URL, because those expire in ~6h and
 * are frequently bound to the IP that resolved them — and the server resolving
 * them is not the machine playing them. Going through here means an expired
 * URL is silently re-derived server-side instead of leaving a dead <video>.
 */
export function registerMusicVideoRoutes(
  app: FastifyInstance,
  deps: MusicVideoRouteDeps,
): void {
  const doFetch = deps.fetchImpl ?? fetch;

  app.get<{ Params: { videoId: string } }>(
    '/api/musicvideo/stream/:videoId',
    async (req, reply) => {
      const { cache, lookup } = deps;
      if (!cache || !lookup) {
        return reply.code(503).send({ error: 'music video lookup not configured' });
      }

      const videoId = req.params.videoId;
      if (!VIDEO_ID_RE.test(videoId)) {
        return reply.code(400).send({ error: 'invalid videoId' });
      }

      // Cached URL, or re-derive when absent/stale.
      let streamUrl = cache.getStream(videoId)?.streamUrl ?? null;
      if (!streamUrl) {
        streamUrl = await lookup.streamUrlFor(videoId);
        if (!streamUrl) return reply.code(404).send({ error: 'video unavailable' });
        cache.putStream(videoId, streamUrl, 0);
      }

      try {
        const headers: Record<string, string> = {};
        const range = req.headers.range;
        if (typeof range === 'string') headers.Range = range;

        const upstream = await doFetch(streamUrl, { headers });
        if (!upstream.ok && upstream.status !== 206) {
          // Almost always an expired or IP-bound URL. Drop it so the next
          // request re-derives rather than serving the same dead link.
          cache.invalidateStream(videoId);
          return reply.code(404).send({ error: 'stream unavailable' });
        }

        for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
          const v = upstream.headers.get(h);
          if (v) reply.header(h, v);
        }
        reply.header('cache-control', 'no-store');
        reply.code(upstream.status);

        if (!upstream.body) return reply.send();

        const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
        // If the kiosk navigates away mid-song, tear down the upstream socket
        // instead of letting it drain bandwidth until process exit.
        req.raw.on('close', () => nodeStream.destroy());
        return reply.send(nodeStream);
      } catch {
        return reply.code(404).send({ error: 'stream unavailable' });
      }
    },
  );
}
