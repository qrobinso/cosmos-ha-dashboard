import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import type { SettingsRepo } from '../store/settings.js';
import type { VideoFileStore } from '../musicvideo/fileStore.js';
import type { AerialCatalogStore } from '../aerials/store.js';
import type { CatalogRefresher } from '../aerials/refresh.js';
import type { AerialDownloader } from '../aerials/download.js';
import { isPlayStart, sendLocalFile } from './localFile.js';

/** Apple asset ids are uppercase UUIDs; be strict, this reaches the filesystem. */
const ASSET_ID_RE = /^[A-Za-z0-9-]{1,40}$/;

/** Settings key for the on-disk aerial cache ceiling, in megabytes. */
export const AERIAL_MAX_CACHE_MB_SETTING = 'aerials.max_cache_mb';
/** Clips run 150–250 MB, so this holds a couple of dozen. */
export const AERIAL_DEFAULT_MAX_CACHE_MB = 4096;
export const AERIAL_MAX_CACHE_MB_LIMIT = 51200; // 50 GB

export function readAerialMaxCacheMb(settings: SettingsRepo | null | undefined): number {
  const raw = settings?.get(AERIAL_MAX_CACHE_MB_SETTING);
  if (raw === null || raw === undefined || raw === '') return AERIAL_DEFAULT_MAX_CACHE_MB;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return AERIAL_DEFAULT_MAX_CACHE_MB;
  return Math.min(AERIAL_MAX_CACHE_MB_LIMIT, n);
}

export type AerialRouteDeps = {
  catalog: AerialCatalogStore;
  refresher: CatalogRefresher;
  /** Null disables local caching; every play proxies Apple. */
  files?: VideoFileStore | null;
  downloader?: AerialDownloader | null;
  settings?: SettingsRepo;
  maxCacheBytes?: () => number;
  /** Injected by tests. */
  fetchImpl?: typeof fetch;
};

export function registerAerialRoutes(app: FastifyInstance, deps: AerialRouteDeps): void {
  const doFetch = deps.fetchImpl ?? fetch;

  app.get('/api/aerials', async () => {
    const cat = deps.catalog.get();
    return {
      fetchedAt: cat?.fetchedAt ?? null,
      assets: (cat?.assets ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        ...(a.subcategory ? { subcategory: a.subcategory } : {}),
        previewUrl: a.previewUrl,
        cached: deps.files?.has(a.id) ?? false,
      })),
    };
  });

  app.post('/api/aerials/refresh', async (_req, reply) => {
    try {
      const cat = await deps.refresher.refreshNow();
      return { fetchedAt: cat.fetchedAt, count: cat.assets.length };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * The kiosk plays every aerial through here, never from Apple directly:
   * a local copy means playback never leaves the house, and the first play
   * of a clip streams through while the download runs behind it.
   */
  app.get<{ Params: { id: string } }>('/api/aerials/stream/:id', async (req, reply) => {
    const id = req.params.id;
    if (!ASSET_ID_RE.test(id)) return reply.code(400).send({ error: 'invalid id' });
    const asset = deps.catalog.assets().find((a) => a.id === id);
    if (!asset) return reply.code(404).send({ error: 'unknown aerial' });

    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const files = deps.files ?? null;
    if (files && isPlayStart(range)) files.recordPlay(id);

    if (files) {
      const local = files.has(id) ? files.pathFor(id) : null;
      if (local) return sendLocalFile(reply, local, range);
      if (deps.downloader) void deps.downloader.start(asset);
    }

    try {
      const headers: Record<string, string> = {};
      if (range) headers.Range = range;
      const upstream = await doFetch(asset.sourceUrl, { headers });
      if (!upstream.ok && upstream.status !== 206) {
        return reply.code(502).send({ error: `upstream returned ${upstream.status}` });
      }
      for (const h of ['content-length', 'accept-ranges', 'content-range']) {
        const v = upstream.headers.get(h);
        if (v) reply.header(h, v);
      }
      // Apple says video/quicktime; the bytes are ISO-BMFF H.264 and Chromium
      // is happiest being told so.
      reply.header('content-type', 'video/mp4');
      reply.header('cache-control', 'public, max-age=604800, immutable');
      reply.code(upstream.status);
      if (!upstream.body) return reply.send();
      const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      req.raw.on('close', () => nodeStream.destroy());
      return reply.send(nodeStream);
    } catch (err) {
      return reply.code(502).send({ error: `upstream fetch failed: ${String(err)}` });
    }
  });

  app.get('/api/aerials/storage', async () => {
    const stats = deps.files?.stats() ?? { fileCount: 0, totalBytes: 0 };
    return {
      maxMb: readAerialMaxCacheMb(deps.settings),
      limitMb: AERIAL_MAX_CACHE_MB_LIMIT,
      enabled: !!deps.files,
      ...stats,
    };
  });

  app.put<{ Body: { maxMb?: unknown } }>('/api/aerials/storage', async (req, reply) => {
    const n = typeof req.body?.maxMb === 'number' ? Math.floor(req.body.maxMb) : NaN;
    if (!Number.isFinite(n) || n < 0) {
      return reply.code(400).send({ error: 'maxMb must be a whole number of megabytes, 0 or more.' });
    }
    if (n > AERIAL_MAX_CACHE_MB_LIMIT) {
      return reply.code(400).send({ error: `maxMb cannot exceed ${AERIAL_MAX_CACHE_MB_LIMIT} MB.` });
    }
    deps.settings?.set(AERIAL_MAX_CACHE_MB_SETTING, String(n));
    // Apply now: lowering the cap is someone reclaiming disk.
    const removed = deps.files?.evict(n * 1024 * 1024) ?? [];
    const stats = deps.files?.stats() ?? { fileCount: 0, totalBytes: 0 };
    return { maxMb: n, removed: removed.length, ...stats };
  });
}
