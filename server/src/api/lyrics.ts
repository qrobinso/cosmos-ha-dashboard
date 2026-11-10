import type { FastifyInstance } from 'fastify';
import type { LyricsCache } from '../lyrics/cache.js';
import type { LyricsSearch } from '../lyrics/lrclib.js';
import { toLines, type LyricsResolver } from '../lyrics/resolver.js';
import { normalizeTrackKey } from '../musicvideo/trackKey.js';
import { MV_NON_MUSIC_TYPES } from '../scenes/assembler.js';
import type { SettingsRepo } from '../store/settings.js';
import type { HaClient } from '../ha/types.js';
import { ADMIN_ENTITY_SETTING } from './musicvideo.js';

/** Matches no scene widget, so a lookup the admin page starts re-pushes nothing. */
const ADMIN_LOOKUP_WIDGET_ID = 'admin:lyrics';
const PREVIEW_LINES = 6;
/** Server-issued keys are `artist|title`; this only rejects junk, not near-misses. */
const TRACK_KEY_RE = /^[^|]+\|.+$/;

export type LyricsRouteDeps = {
  cache: LyricsCache;
  search: LyricsSearch | null;
  settings?: SettingsRepo | null;
  haClient?: HaClient | null;
  /** A getter because the resolver is constructed after the HTTP app. */
  resolver?: () => LyricsResolver | null;
  /** Fired after a pin/block/unpin so the host can re-push displays. */
  onChanged?: (trackKey: string) => void;
};

/**
 * Lyrics admin: see how the watched player's song matched, pick the right
 * LRCLIB record when it matched wrong, or block lyrics for a song. The watched
 * player is the Video Backdrop page's setting — one "what's playing" for both.
 */
export function registerLyricsRoutes(app: FastifyInstance, deps: LyricsRouteDeps): void {
  const { cache } = deps;

  app.get('/api/lyrics/pins', async () => cache.list({ pinned: true }));

  app.get<{ Querystring: { q?: string } }>('/api/lyrics/history', async (req) =>
    cache.list({ q: typeof req.query.q === 'string' ? req.query.q : undefined }),
  );

  app.get<{ Querystring: { q?: string } }>('/api/lyrics/search', async (req, reply) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q || !deps.search) return [];
    try {
      return await deps.search.search(q);
    } catch (err) {
      return reply.code(502).send({ error: `LRCLIB could not be reached: ${(err as Error).message}` });
    }
  });

  app.post<{ Body: { trackKey?: unknown; lrclibId?: unknown; block?: unknown } }>(
    '/api/lyrics/pins',
    async (req, reply) => {
      const trackKey = typeof req.body?.trackKey === 'string' ? req.body.trackKey : '';
      if (!TRACK_KEY_RE.test(trackKey) || trackKey.length > 500) {
        return reply.code(400).send({ error: 'A song is required.' });
      }

      if (req.body?.block === true) {
        cache.pin(trackKey, null);
        deps.onChanged?.(trackKey);
        return cache.info(trackKey);
      }

      const id = req.body?.lrclibId;
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: 'Pick one of the search results first.' });
      }
      if (!deps.search) return reply.code(503).send({ error: 'Lyrics search is not available.' });

      let picked;
      try {
        picked = await deps.search.byId(id);
      } catch (err) {
        return reply.code(502).send({ error: `LRCLIB could not be reached: ${(err as Error).message}` });
      }
      if (!picked) return reply.code(400).send({ error: 'LRCLIB no longer has that entry. Search again.' });

      const c = picked.candidate;
      cache.pin(trackKey, picked.result, `${c.artist} — ${c.track}${c.album ? ` (${c.album})` : ''}`);
      deps.onChanged?.(trackKey);
      return cache.info(trackKey);
    },
  );

  app.delete<{ Params: { trackKey: string } }>('/api/lyrics/pins/:trackKey', async (req, reply) => {
    if (!cache.unpin(req.params.trackKey)) return reply.code(404).send({ error: 'No pin for that song.' });
    deps.onChanged?.(req.params.trackKey);
    return { ok: true };
  });

  app.get('/api/lyrics/now-playing', async () => {
    const entityId = deps.settings?.get(ADMIN_ENTITY_SETTING) || null;
    if (!entityId) return { entityId: null, status: 'no-entity' as const };

    const entity = deps.haClient?.listEntities().find((e) => e.entity_id === entityId) ?? null;
    if (!entity) return { entityId, status: 'entity-missing' as const };

    const a = (entity.attributes ?? {}) as Record<string, unknown>;
    const artist = typeof a.media_artist === 'string' ? a.media_artist : '';
    const title = typeof a.media_title === 'string' ? a.media_title : '';
    const durationSec = typeof a.media_duration === 'number' ? a.media_duration : undefined;
    const base = { entityId, state: entity.state, artist, title, durationSec };

    // Same denylist as the assembler: a TV episode reports artist/title too.
    const contentType = typeof a.media_content_type === 'string' ? a.media_content_type.toLowerCase() : '';
    if (MV_NON_MUSIC_TYPES.has(contentType)) return { ...base, trackKey: null, status: 'non-music' as const };

    const trackKey = normalizeTrackKey(artist, title);
    if (!trackKey) return { ...base, trackKey: null, status: 'nothing-playing' as const };

    // `get` (not `info`) decides whether an answer exists: it is what the
    // resolver reads, and it treats an expired miss as "not looked up yet".
    const cached = cache.get(trackKey);
    if (!cached) {
      // No scene widget may be watching this player, so start the lookup here;
      // the page's poll picks the answer up.
      if (entity.state === 'playing') deps.resolver?.()?.(ADMIN_LOOKUP_WIDGET_ID, { artist, title, durationSec });
      return { ...base, trackKey, status: 'unresolved' as const };
    }

    const row = cache.info(trackKey)!;
    const lines = cached.result ? toLines(cached.result).lines : null;
    return {
      ...base,
      trackKey,
      status: row.pinned
        ? row.kind === 'none' ? ('blocked' as const) : ('pinned' as const)
        : row.kind === 'none' ? ('nothing-found' as const) : ('auto' as const),
      kind: row.kind,
      label: row.label,
      preview: (lines ?? []).slice(0, PREVIEW_LINES).map((l) => l.text),
    };
  });
}
