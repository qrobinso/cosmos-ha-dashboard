import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import type { MusicVideoCache } from '../musicvideo/cache.js';
import { mvLog, mvWarn } from '../musicvideo/log.js';
import type { VideoLookup } from '../musicvideo/types.js';
import type { MusicVideoOverrideRepo } from '../musicvideo/overrides.js';
import type { SettingsRepo } from '../store/settings.js';
import type { HaClient } from '../ha/types.js';
import { parseYouTubeId } from '../musicvideo/youtubeUrl.js';
import { normalizeTrackKey } from '../musicvideo/trackKey.js';
import { MV_NON_MUSIC_TYPES } from '../scenes/assembler.js';

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

export type MusicVideoRouteDeps = {
  cache: MusicVideoCache | null;
  lookup: VideoLookup | null;
  /** Manual pin/block store. Null when the feature is not wired (tests). */
  musicVideoOverrides?: MusicVideoOverrideRepo | null;
  settings?: SettingsRepo | null;
  haClient?: HaClient | null;
  /** Fired after any override mutation so the host can re-push displays. */
  onOverridesChanged?: () => void;
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

      mvLog(`stream req videoId=${videoId} range=${req.headers.range ?? 'none'}`);

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
        const range = req.headers.range;
        if (typeof range === 'string') headers.Range = range;

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
  app.get<{ Querystring: { q?: string } }>('/api/musicvideo/history', async (req) => {
    if (!deps.cache) return [];
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    return q ? deps.cache.search(q, SEARCH_LIMIT) : deps.cache.listRecent(HISTORY_LIMIT);
  });

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
    const cached = deps.cache?.getVideoId(trackKey) ?? null;

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
    };
  });
}
