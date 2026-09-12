import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { statSync } from 'node:fs';
import { isPlayStart, sendLocalFile } from './localFile.js';
import type { MusicVideoCache } from '../musicvideo/cache.js';
import { mvLog, mvWarn } from '../musicvideo/log.js';
import type { VideoLookup } from '../musicvideo/types.js';
import type { MusicVideoOverrideRepo } from '../musicvideo/overrides.js';
import type { SettingsRepo } from '../store/settings.js';
import type { HaClient } from '../ha/types.js';
import { parseYouTubeId } from '../musicvideo/youtubeUrl.js';
import { normalizeTrackKey } from '../musicvideo/trackKey.js';
import { MV_NON_MUSIC_TYPES } from '../scenes/assembler.js';
import type { VideoFileStore } from '../musicvideo/fileStore.js';

/** YouTube ids are 11 chars of [A-Za-z0-9_-]; be strict, this reaches fetch(). */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{3,20}$/;

/** Settings key for the media_player the admin overrides page watches. */
export const ADMIN_ENTITY_SETTING = 'musicvideo.admin_entity';

const HISTORY_LIMIT = 50;

/**
 * Search reaches every remembered song, so it needs its own ceiling — but a
 * higher one than the Recent list, since a broad term like "love" legitimately
 * matches more than 50 and silently truncating to the Recent limit would hide
 * the very row the user is hunting for.
 */
const SEARCH_LIMIT = 200;

/**
 * Widget id used when the admin page triggers its own lookup. Deliberately not
 * a real widget id: the resolver's `onUpdate` callback matches it against
 * scene widgets, finds nothing, and marks no display dirty — this lookup exists
 * to answer the admin page, not to change what any wall is showing.
 */
const ADMIN_LOOKUP_WIDGET_ID = 'admin:musicvideo';

/** Settings key for the on-disk video cache ceiling, in megabytes. */
export const MAX_CACHE_MB_SETTING = 'musicvideo.max_cache_mb';

/**
 * Default ceiling. A 360p video runs a few MB, so this holds a few hundred
 * songs — generous for a household, and small enough not to surprise anyone
 * running Home Assistant from an SD card.
 */
export const DEFAULT_MAX_CACHE_MB = 1024;

/** Hard ceiling on what the setting accepts, so a typo cannot fill the disk. */
export const MAX_CACHE_MB_LIMIT = 51200; // 50 GB

export function readMaxCacheMb(settings: SettingsRepo | null | undefined): number {
  const raw = settings?.get(MAX_CACHE_MB_SETTING);
  if (raw === null || raw === undefined || raw === '') return DEFAULT_MAX_CACHE_MB;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MAX_CACHE_MB;
  return Math.min(MAX_CACHE_MB_LIMIT, n);
}

/** Parse a query-string integer, falling back and clamping — a hand-edited
 *  `?limit=99999` must not turn into an unbounded query. */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export type MusicVideoRouteDeps = {
  cache: MusicVideoCache | null;
  lookup: VideoLookup | null;
  /** Manual pin/block store. Null when the feature is not wired (tests). */
  musicVideoOverrides?: MusicVideoOverrideRepo | null;
  settings?: SettingsRepo | null;
  haClient?: HaClient | null;
  /** Fired after any override mutation so the host can re-push displays. */
  onOverridesChanged?: () => void;
  /** Lets `now-playing` resolve a track the scene widgets are not watching.
   *  A getter because the resolver is constructed after the HTTP app. */
  musicVideoResolver?: () => import('../musicvideo/resolver.js').MusicVideoResolver | null;
  /** Local downloaded-video store. Null disables downloading entirely. */
  files?: VideoFileStore | null;
  /** Current size cap in bytes, read fresh so a settings change takes effect
   *  without a restart. 0 means "do not download". */
  maxCacheBytes?: () => number;
  /** Injected by tests. */
  fetchImpl?: typeof fetch;
};

/**
 * Downloads in flight, so a burst of range requests for the same uncached
 * video spawns one yt-dlp rather than one per connection — the same stampede
 * guard `inFlightUrls` provides on the URL side.
 */
const inFlightDownloads = new Set<string>();

/**
 * Fetch the whole video to disk in the background.
 *
 * Never awaited by the request that triggers it: the first play still streams
 * through the proxy so the user waits for nothing, and every later play is
 * served locally. This is what stops the "upstream returned 403" churn — a
 * googlevideo URL expires and is bound to the client that resolved it, but a
 * file on disk is neither.
 */
function startDownload(
  videoId: string,
  lookup: VideoLookup,
  files: VideoFileStore,
  maxBytes: number,
): void {
  if (maxBytes <= 0 || inFlightDownloads.has(videoId) || files.has(videoId)) return;
  const dest = files.pathFor(videoId);
  if (!dest) return;

  inFlightDownloads.add(videoId);
  void (async () => {
    try {
      const ok = await lookup.download(videoId, dest);
      if (!ok) {
        mvLog(`download failed videoId=${videoId} — will keep proxying`);
        return;
      }
      let bytes = 0;
      try {
        bytes = statSync(dest).size;
      } catch {
        mvLog(`download reported success but no file videoId=${videoId}`);
        return;
      }
      files.record(videoId, bytes);
      mvLog(`download ok videoId=${videoId} bytes=${bytes}`);

      const removed = files.evict(maxBytes);
      if (removed.length) {
        mvLog(`evicted ${removed.length} video(s) to stay under the cap: ${removed.join(', ')}`);
      }
    } catch (err) {
      mvLog(`download threw videoId=${videoId} ${String(err)}`);
    } finally {
      inFlightDownloads.delete(videoId);
    }
  })();
}

/**
 * Proxies the YouTube progressive stream to the kiosk.
 *
 * The display never sees a googlevideo URL, because those expire in ~6h and
 * are frequently bound to the IP that resolved them — and the server resolving
 * them is not the machine playing them. Going through here means an expired
 * URL is silently re-derived server-side instead of leaving a dead <video>.
 */
/**
 * Re-derive a stream URL, collapsing concurrent requests for the same video.
 *
 * Every display showing the scene requests the stream, and a browser opens
 * several ranged connections per video. Without this, one stale URL meant a
 * yt-dlp spawn per connection — the exact stampede the resolver's concurrency
 * cap prevents on the lookup side.
 */
const inFlightUrls = new Map<string, Promise<string | null>>();

async function deriveStreamUrl(
  videoId: string,
  lookup: VideoLookup,
  cache: MusicVideoCache,
): Promise<string | null> {
  const existing = inFlightUrls.get(videoId);
  if (existing) return existing;

  const p = (async () => {
    try {
      const url = await lookup.streamUrlFor(videoId);
      // streamUrlFor only re-derives the URL, not the duration. `duration`
      // has no reader today (the widget reads it off the <video> element
      // instead), so this would be harmless to get wrong — but keep it
      // honest rather than clobbering a previously-known value to 0, in
      // case something later wires it into SceneState.
      if (url) cache.putStream(videoId, url, cache.peekStreamDuration(videoId));
      return url;
    } finally {
      inFlightUrls.delete(videoId);
    }
  })();

  inFlightUrls.set(videoId, p);
  return p;
}

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
        mvWarn(`stream 400 videoId=${JSON.stringify(videoId)} rejected by charset guard`);
        return reply.code(400).send({ error: 'invalid videoId' });
      }

      const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
      mvLog(`stream req videoId=${videoId} range=${range ?? 'none'}`);

      const files = deps.files ?? null;
      const maxBytes = deps.maxCacheBytes?.() ?? 0;

      if (files && isPlayStart(range)) files.recordPlay(videoId);

      // A local copy beats the proxy on every axis: no yt-dlp spawn, no
      // googlevideo round trip, and no 403 when a URL expires mid-song.
      if (files) {
        const local = files.has(videoId) ? files.pathFor(videoId) : null;
        if (local) {
          mvLog(`stream local videoId=${videoId}`);
          return sendLocalFile(reply, local, range);
        }
        // Not stored yet — proxy this play, and fetch it for the next one.
        startDownload(videoId, lookup, files, maxBytes);
      }

      // Cached URL, or re-derive when absent/stale.
      let streamUrl = cache.getStream(videoId)?.streamUrl ?? null;
      if (!streamUrl) {
        mvLog(`stream url absent or stale videoId=${videoId} — re-deriving via yt-dlp`);
        streamUrl = await deriveStreamUrl(videoId, lookup, cache);
        if (!streamUrl) {
          mvWarn(`stream 404 videoId=${videoId} — could not re-derive a stream url`);
          return reply.code(404).send({ error: 'video unavailable' });
        }
        mvLog(`stream url re-derived videoId=${videoId}`);
      }

      try {
        const headers: Record<string, string> = {};
        if (range) headers.Range = range;

        const upstream = await doFetch(streamUrl, { headers });
        if (!upstream.ok && upstream.status !== 206) {
          // Almost always an expired or IP-bound URL. Drop it so the next
          // request re-derives rather than serving the same dead link.
          cache.invalidateStream(videoId);
          mvWarn(
            `stream 404 videoId=${videoId} — upstream returned ${upstream.status} ` +
              `(url expired or IP-bound); cached url invalidated, next request re-derives`,
          );
          return reply.code(404).send({ error: 'stream unavailable' });
        }

        for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
          const v = upstream.headers.get(h);
          if (v) reply.header(h, v);
        }
        // The bytes behind a videoId never change, so let the browser keep
        // them. This is the single biggest lever on this feature's footprint:
        // with `no-store` the kiosk re-downloaded the entire file through this
        // proxy on every loop of a short video under a longer song, and again
        // on every replay of the track — a real 5.4 MB per pass for a 3:29
        // video at 360p. `immutable` also suppresses revalidation round-trips.
        //
        // Only the upstream googlevideo URL expires; the content does not, and
        // the display never sees that URL.
        reply.header('cache-control', 'public, max-age=604800, immutable');
        reply.code(upstream.status);
        mvLog(
          `stream ok  videoId=${videoId} upstream=${upstream.status} ` +
            `type=${upstream.headers.get('content-type') ?? '?'} ` +
            `len=${upstream.headers.get('content-length') ?? '?'}`,
        );

        if (!upstream.body) return reply.send();

        const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
        // If the kiosk navigates away mid-song, tear down the upstream socket
        // instead of letting it drain bandwidth until process exit.
        req.raw.on('close', () => nodeStream.destroy());
        return reply.send(nodeStream);
      } catch (err) {
        mvWarn(`stream 404 videoId=${videoId} — upstream fetch threw: ${String(err)}`);
        return reply.code(404).send({ error: 'stream unavailable' });
      }
    },
  );

  app.get('/api/musicvideo/overrides', async () => deps.musicVideoOverrides?.list() ?? []);

  /** Recent resolutions, or — with `?q=` — a search across every remembered
   *  song. Search is a superset of the list rather than a filter over it: the
   *  rows worth fixing are usually the ones that scrolled out of Recent. */
  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>(
    '/api/musicvideo/history',
    async (req) => {
      if (!deps.cache) return { rows: [], total: 0, limit: HISTORY_LIMIT, offset: 0 };

      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const limit = clampInt(req.query.limit, HISTORY_LIMIT, 1, SEARCH_LIMIT);
      const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

      const rows = q
        ? deps.cache.search(q, limit, offset)
        : deps.cache.listRecent(limit, offset);
      // `total` counts every row the query can reach, not just this page —
      // it is what lets the client show "x–y of N" and disable Next honestly.
      return { rows, total: deps.cache.count(q), limit, offset };
    },
  );

  app.post<{ Body: { artist?: unknown; title?: unknown; url?: unknown; block?: unknown } }>(
    '/api/musicvideo/overrides',
    async (req, reply) => {
      const overrides = deps.musicVideoOverrides;
      if (!overrides) return reply.code(503).send({ error: 'Music video overrides are not available.' });

      const artist = typeof req.body?.artist === 'string' ? req.body.artist.trim() : '';
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';

      // The client never computes a track key. Deriving it here is what
      // guarantees the admin page and the resolver can never disagree about
      // which song a pin applies to.
      const trackKey = normalizeTrackKey(artist, title);
      if (!trackKey) {
        return reply.code(400).send({ error: 'A non-empty artist and title are required.' });
      }

      if (req.body?.block === true) {
        // Nothing to validate — there is no video.
        overrides.put({ trackKey, videoId: null, artist, title });
        deps.onOverridesChanged?.();
        return { trackKey, videoId: null, artist, title, blocked: true };
      }

      const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
      const videoId = parseYouTubeId(rawUrl);
      if (!videoId) {
        return reply.code(400).send({
          error: 'That does not look like a YouTube link. Paste a youtube.com/watch, youtu.be, or music.youtube.com URL.',
        });
      }

      if (!deps.lookup) {
        return reply.code(400).send({ error: 'Video lookup is not configured, so the link cannot be checked. Try again once yt-dlp is available.' });
      }

      const probed = await deps.lookup.probe(videoId);
      if (probed.status === 'unavailable') {
        // Distinct from a bad video: the link may be perfectly fine. Say so,
        // or the user goes hunting for a replacement that will not help.
        return reply.code(400).send({ error: 'yt-dlp could not be run, so the link could not be checked. Try again in a few minutes.' });
      }
      if (probed.status !== 'ok') {
        return reply.code(400).send({ error: 'That video could not be played — it may be private, removed, age-restricted, or region-locked. Try a different link.' });
      }

      // Populating the stream cache here is what makes the pin playable on the
      // very next push instead of costing another yt-dlp call.
      deps.cache?.putStream(videoId, probed.video.streamUrl, probed.video.duration);
      overrides.put({ trackKey, videoId, artist, title });
      deps.onOverridesChanged?.();

      return {
        trackKey,
        videoId,
        artist,
        title,
        blocked: false,
        resolvedTitle: probed.video.title,
        durationSec: probed.video.duration,
      };
    },
  );

  app.delete<{ Params: { trackKey: string } }>(
    '/api/musicvideo/overrides/:trackKey',
    async (req, reply) => {
      const overrides = deps.musicVideoOverrides;
      if (!overrides) return reply.code(503).send({ error: 'Music video overrides are not available.' });
      if (!overrides.remove(req.params.trackKey)) {
        return reply.code(404).send({ error: 'No override for that track.' });
      }
      deps.onOverridesChanged?.();
      return { ok: true };
    },
  );

  app.get('/api/musicvideo/storage', async () => {
    const stats = deps.files?.stats() ?? { fileCount: 0, totalBytes: 0 };
    return {
      maxMb: readMaxCacheMb(deps.settings),
      limitMb: MAX_CACHE_MB_LIMIT,
      enabled: !!deps.files,
      ...stats,
    };
  });

  app.put<{ Body: { maxMb?: unknown } }>('/api/musicvideo/storage', async (req, reply) => {
    const n = typeof req.body?.maxMb === 'number' ? Math.floor(req.body.maxMb) : NaN;
    if (!Number.isFinite(n) || n < 0) {
      return reply.code(400).send({ error: 'maxMb must be a whole number of megabytes, 0 or more.' });
    }
    if (n > MAX_CACHE_MB_LIMIT) {
      return reply.code(400).send({ error: `maxMb cannot exceed ${MAX_CACHE_MB_LIMIT} MB.` });
    }
    deps.settings?.set(MAX_CACHE_MB_SETTING, String(n));

    // Apply immediately rather than at the next download: lowering the cap is
    // usually someone reclaiming disk NOW, and 0 means "stop storing videos",
    // which would be a strange thing to leave half-done.
    const removed = deps.files?.evict(n * 1024 * 1024) ?? [];
    if (removed.length) mvLog(`storage cap lowered — evicted ${removed.length} video(s)`);

    const stats = deps.files?.stats() ?? { fileCount: 0, totalBytes: 0 };
    return { maxMb: n, removed: removed.length, ...stats };
  });

  app.get('/api/musicvideo/settings', async () => ({
    entityId: deps.settings?.get(ADMIN_ENTITY_SETTING) || null,
  }));

  app.put<{ Body: { entityId?: unknown } }>('/api/musicvideo/settings', async (req, reply) => {
    const entityId = typeof req.body?.entityId === 'string' ? req.body.entityId.trim() : '';
    if (entityId && !entityId.startsWith('media_player.')) {
      return reply.code(400).send({ error: 'Expected a media_player entity.' });
    }
    deps.settings?.set(ADMIN_ENTITY_SETTING, entityId);
    return { entityId: entityId || null };
  });

  app.get('/api/musicvideo/now-playing', async () => {
    const entityId = deps.settings?.get(ADMIN_ENTITY_SETTING) ?? null;
    if (!entityId) return { entityId: null, status: 'no-entity' as const };

    const entity = deps.haClient?.listEntities().find((e) => e.entity_id === entityId) ?? null;
    if (!entity) return { entityId, status: 'entity-missing' as const };

    const a = (entity.attributes ?? {}) as Record<string, unknown>;
    const artist = typeof a.media_artist === 'string' ? a.media_artist : '';
    const title = typeof a.media_title === 'string' ? a.media_title : '';

    // Mirror the assembler's denylist: a TV episode reports artist/title too,
    // and without this check a pin here would look active but never play —
    // the resolver skips lookups for these content types entirely.
    const contentType =
      typeof a.media_content_type === 'string' ? a.media_content_type.toLowerCase() : '';
    if (MV_NON_MUSIC_TYPES.has(contentType)) {
      return { entityId, state: entity.state, artist, title, trackKey: null, status: 'non-music' as const };
    }

    const trackKey = normalizeTrackKey(artist, title);
    if (!trackKey) {
      return { entityId, state: entity.state, artist, title, trackKey: null, status: 'nothing-playing' as const };
    }

    const override = deps.musicVideoOverrides?.get(trackKey) ?? null;
    let cached = deps.cache?.getVideoId(trackKey) ?? null;

    /*
     * Start a lookup ourselves when there is no answer yet.
     *
     * This page must not depend on some scene widget happening to watch the
     * same media_player. The widget's `entity_id` and this page's watched
     * entity are independent settings, so for any player no widget follows,
     * nothing would ever populate the cache — and the page would sit on
     * "Looking…" forever while, in truth, nobody was looking.
     *
     * The resolver is non-blocking: this returns immediately with no answer,
     * the lookup lands in the background, and the page's 5s poll picks it up.
     * The synthetic widget id matches no scene widget, so the resulting
     * `onUpdate` marks nothing dirty — exactly what we want, since this
     * lookup is for the admin page, not a display.
     */
    const resolver = deps.musicVideoResolver?.() ?? null;
    if (!override && !cached && entity.state === 'playing' && resolver) {
      resolver(ADMIN_LOOKUP_WIDGET_ID, {
        artist,
        title,
        durationSec: typeof a.media_duration === 'number' ? a.media_duration : undefined,
      });
      // The resolver writes through the cache synchronously on a hit, so a
      // result that was already in flight may be available right now.
      cached = deps.cache?.getVideoId(trackKey) ?? null;
    }

    // Precedence here MUST mirror the resolver's, or the page will describe a
    // state the wall display is not in.
    const status = override
      ? override.videoId
        ? ('pinned' as const)
        : ('blocked' as const)
      : cached?.videoId
        ? ('auto' as const)
        : cached
          ? ('nothing-found' as const)
          : ('unresolved' as const);

    return {
      entityId,
      state: entity.state,
      artist,
      title,
      trackKey,
      status,
      videoId: override ? override.videoId : (cached?.videoId ?? null),
      /** Why nothing matched, when we know. Null unless status is nothing-found. */
      reason: cached?.reason ?? null,
    };
  });
}
