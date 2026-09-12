import type { SceneState } from '$lib/types';

type SceneRecord = SceneState; // shape used by the editor

async function jsonOr<T>(res: Response, fallback: T): Promise<T> {
  if (!res.ok) return fallback;
  return (await res.json()) as T;
}

async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  const text = await res.text();
  throw new Error(`HTTP ${res.status}: ${text}`);
}

/** One row of GET /api/aerials. */
export type AerialCatalogEntry = {
  id: string;
  name: string;
  category: import('$lib/types').AerialCategory;
  subcategory?: string;
  previewUrl: string;
  cached: boolean;
};

export const api = {
  scenes: {
    async list(): Promise<SceneRecord[]> {
      return jsonOr(await fetch('/api/scenes'), []);
    },
    async get(id: string): Promise<SceneRecord | null> {
      const res = await fetch(`/api/scenes/${id}`);
      if (res.status === 404) return null;
      await ensureOk(res);
      return (await res.json()) as SceneRecord;
    },
    async create(payload: object): Promise<SceneRecord> {
      const res = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await ensureOk(res);
      return (await res.json()) as SceneRecord;
    },
    async update(id: string, payload: object): Promise<SceneRecord> {
      const res = await fetch(`/api/scenes/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await ensureOk(res);
      return (await res.json()) as SceneRecord;
    },
    async delete(id: string): Promise<void> {
      await ensureOk(await fetch(`/api/scenes/${id}`, { method: 'DELETE' }));
    },
  },
  displays: {
    async list(): Promise<{ id: string; name: string; lastSeen: string | null; defaultSceneId: string | null; currentSceneId: string | null; rotation: { enabled: boolean; sceneIds: string[]; intervalSec: number } | null; orientation: 'landscape' | 'portrait'; voiceEnabled: boolean; voicePipelineId: string | null; micHealth: string | null }[]> {
      return jsonOr(await fetch('/api/displays'), []);
    },
    async setRotation(displayName: string, payload: { enabled: boolean; sceneIds: string[]; intervalSec: number }): Promise<void> {
      await ensureOk(
        await fetch(`/api/displays/${encodeURIComponent(displayName)}/rotation`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      );
    },
    async setOrientation(displayName: string, orientation: 'landscape' | 'portrait'): Promise<void> {
      await ensureOk(
        await fetch(`/api/displays/${encodeURIComponent(displayName)}/orientation`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orientation }),
        })
      );
    },
    async setVoice(displayName: string, opts: { enabled: boolean; pipelineId: string | null }): Promise<void> {
      await ensureOk(
        await fetch(`/api/displays/${encodeURIComponent(displayName)}/voice`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(opts),
        })
      );
    },
    async assignScene(displayName: string, sceneId: string, makeDefault: boolean): Promise<void> {
      await ensureOk(
        await fetch(`/api/displays/${encodeURIComponent(displayName)}/assign-scene`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sceneId, makeDefault }),
        })
      );
    },
    async activateScene(displayName: string, sceneId: string, transitionId: string | null = null): Promise<void> {
      await ensureOk(
        await fetch(`/api/displays/${encodeURIComponent(displayName)}/scene/activate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sceneId, transitionId }),
        })
      );
    },
    async delete(displayName: string): Promise<void> {
      await ensureOk(
        await fetch(`/api/displays/${encodeURIComponent(displayName)}`, { method: 'DELETE' })
      );
    },
  },
  transitions: {
    async list(): Promise<{ id: string; name: string }[]> {
      return jsonOr(await fetch('/api/transitions'), []);
    },
  },
  settings: {
    async getSafeArea(): Promise<{ top: number; right: number; bottom: number; left: number }> {
      const res = await fetch('/api/settings/safe-area');
      return (await res.json()) as { top: number; right: number; bottom: number; left: number };
    },
    async updateSafeArea(payload: { top?: number; right?: number; bottom?: number; left?: number }): Promise<{ top: number; right: number; bottom: number; left: number }> {
      const res = await fetch('/api/settings/safe-area', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await ensureOk(res);
      return (await res.json()) as { top: number; right: number; bottom: number; left: number };
    },
    async getTransitionSpeed(): Promise<{ multiplier: number; min: number; max: number; default: number }> {
      const res = await fetch('/api/settings/transition-speed');
      return (await res.json()) as { multiplier: number; min: number; max: number; default: number };
    },
    async updateTransitionSpeed(multiplier: number): Promise<{ multiplier: number }> {
      const res = await fetch('/api/settings/transition-speed', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ multiplier }),
      });
      await ensureOk(res);
      return (await res.json()) as { multiplier: number };
    },
    async getCanvasFetch(): Promise<{ mode: 'off' | 'allowlist' | 'any'; allowlist: string[] }> {
      const res = await fetch('/api/settings/canvas-fetch');
      return (await res.json()) as { mode: 'off' | 'allowlist' | 'any'; allowlist: string[] };
    },
    async updateCanvasFetch(payload: {
      mode: 'off' | 'allowlist' | 'any';
      allowlist: string[];
    }): Promise<{ mode: 'off' | 'allowlist' | 'any'; allowlist: string[] }> {
      const res = await fetch('/api/settings/canvas-fetch', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await ensureOk(res);
      return (await res.json()) as { mode: 'off' | 'allowlist' | 'any'; allowlist: string[] };
    },
    async getHomeAssistant(): Promise<{
      url: string | null;
      hasToken: boolean;
      runtime: {
        source: 'environment' | 'manual' | 'supervisor' | 'mock';
        activeUrl: string | null;
        connected: boolean;
        envConfigured: boolean;
        supervisorAvailable: boolean;
      };
    }> {
      const res = await fetch('/api/settings/home-assistant');
      return (await res.json()) as {
        url: string | null;
        hasToken: boolean;
        runtime: {
          source: 'environment' | 'manual' | 'supervisor' | 'mock';
          activeUrl: string | null;
          connected: boolean;
          envConfigured: boolean;
          supervisorAvailable: boolean;
        };
      };
    },
    async updateHomeAssistant(payload: { url?: string; token?: string }): Promise<{
      url: string | null;
      hasToken: boolean;
      runtime: {
        source: 'environment' | 'manual' | 'supervisor' | 'mock';
        activeUrl: string | null;
        connected: boolean;
        envConfigured: boolean;
        supervisorAvailable: boolean;
      };
    }> {
      const res = await fetch('/api/settings/home-assistant', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await ensureOk(res);
      return (await res.json()) as {
        url: string | null;
        hasToken: boolean;
        runtime: {
          source: 'environment' | 'manual' | 'supervisor' | 'mock';
          activeUrl: string | null;
          connected: boolean;
          envConfigured: boolean;
          supervisorAvailable: boolean;
        };
      };
    },
  },
  ha: {
    async listEntities(domain?: string): Promise<{ entity_id: string; state: string; attributes: Record<string, unknown> }[]> {
      const url = domain ? `/api/ha/entities?domain=${encodeURIComponent(domain)}` : '/api/ha/entities';
      return jsonOr(await fetch(url), []);
    },
    async listAssistPipelines(): Promise<{ id: string; name: string }[]> {
      return jsonOr(await fetch('/api/ha/assist-pipelines'), []);
    },
  },
  agent: {
    async getSettings(): Promise<{ hasKey: boolean; model: string; confirmRequiredTools: string[] }> {
      const res = await fetch('/api/agent/settings');
      return (await res.json()) as { hasKey: boolean; model: string; confirmRequiredTools: string[] };
    },
    async updateSettings(payload: { key?: string; model?: string }): Promise<{ hasKey: boolean; model: string; confirmRequiredTools: string[] }> {
      const res = await fetch('/api/agent/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await ensureOk(res);
      return (await res.json()) as { hasKey: boolean; model: string; confirmRequiredTools: string[] };
    },
    async getServerTime(): Promise<{ now: number; iso: string }> {
      const res = await fetch('/api/agent/time');
      return (await res.json()) as { now: number; iso: string };
    },
    async getMcpConfig(): Promise<{ enabled: boolean; hasToken: boolean; token: string | null; endpointHosts: string[] }> {
      const res = await fetch('/api/agent/mcp');
      return (await res.json()) as { enabled: boolean; hasToken: boolean; token: string | null; endpointHosts: string[] };
    },
    async enableMcp(enabled: boolean): Promise<{ enabled: boolean; hasToken: boolean; token: string | null; endpointHosts: string[] }> {
      const res = await fetch('/api/agent/mcp/enable', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await ensureOk(res);
      return (await res.json()) as { enabled: boolean; hasToken: boolean; token: string | null; endpointHosts: string[] };
    },
    async regenerateMcpToken(): Promise<{ enabled: boolean; hasToken: boolean; token: string | null; endpointHosts: string[] }> {
      const res = await fetch('/api/agent/mcp/regenerate', { method: 'POST' });
      await ensureOk(res);
      return (await res.json()) as { enabled: boolean; hasToken: boolean; token: string | null; endpointHosts: string[] };
    },
  },
  moods: {
    async list(): Promise<{ id: string; label: string; tags: string[] }[]> {
      return jsonOr(await fetch('/api/moods'), []);
    },
  },
  aerials: {
    async list(): Promise<{ fetchedAt: number | null; assets: AerialCatalogEntry[] }> {
      return jsonOr(await fetch('/api/aerials'), { fetchedAt: null, assets: [] });
    },
    /** Returns the parsed body even on a non-2xx so the page can show the reason. */
    async refresh(): Promise<{ ok: true; fetchedAt: number; count: number } | { ok: false; error: string }> {
      const res = await fetch('/api/aerials/refresh', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { ok: false, error: (body.error as string) ?? 'Refresh failed.' };
      return { ok: true, fetchedAt: body.fetchedAt as number, count: body.count as number };
    },
    async getStorage(): Promise<{ maxMb: number; limitMb: number; enabled: boolean; fileCount: number; totalBytes: number }> {
      return jsonOr(await fetch('/api/aerials/storage'), {
        maxMb: 0, limitMb: 0, enabled: false, fileCount: 0, totalBytes: 0,
      });
    },
    async setStorage(maxMb: number): Promise<
      { ok: true; maxMb: number; removed: number; fileCount: number; totalBytes: number } | { ok: false; error: string }
    > {
      const res = await fetch('/api/aerials/storage', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxMb }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { ok: false, error: (body.error as string) ?? 'Save failed.' };
      return { ok: true, ...(body as unknown as { maxMb: number; removed: number; fileCount: number; totalBytes: number }) };
    },
  },
  canvases: {
    async subscribe(widgetId: string, displayName: string, entityIds: string[]): Promise<void> {
      await fetch(`/api/canvases/${encodeURIComponent(widgetId)}/subscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, entity_ids: entityIds }),
      });
    },
  },
  musicvideo: {
    async getStorage(): Promise<{ maxMb: number; limitMb: number; enabled: boolean; fileCount: number; totalBytes: number }> {
      return jsonOr(await fetch('/api/musicvideo/storage'), {
        maxMb: 0, limitMb: 0, enabled: false, fileCount: 0, totalBytes: 0,
      });
    },
    /** Returns the parsed body even on a non-2xx so the page can show the reason. */
    async setStorage(maxMb: number): Promise<
      { ok: true; maxMb: number; removed: number; fileCount: number; totalBytes: number } | { ok: false; error: string }
    > {
      const res = await fetch('/api/musicvideo/storage', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxMb }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { ok: false, error: (body.error as string) ?? 'Save failed.' };
      return { ok: true, ...(body as unknown as { maxMb: number; removed: number; fileCount: number; totalBytes: number }) };
    },
    async getSettings(): Promise<{ entityId: string | null }> {
      const res = await fetch('/api/musicvideo/settings');
      return (await res.json()) as { entityId: string | null };
    },
    async setSettings(entityId: string): Promise<{ entityId: string | null }> {
      const res = await fetch('/api/musicvideo/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId }),
      });
      await ensureOk(res);
      return (await res.json()) as { entityId: string | null };
    },
    async nowPlaying(): Promise<{
      entityId: string | null;
      state?: string;
      artist?: string;
      title?: string;
      trackKey?: string | null;
      status: 'no-entity' | 'entity-missing' | 'nothing-playing' | 'non-music' | 'pinned' | 'blocked' | 'auto' | 'nothing-found' | 'unresolved';
      videoId?: string | null;
    }> {
      const res = await fetch('/api/musicvideo/now-playing');
      return (await res.json());
    },
    async listOverrides(): Promise<
      Array<{ trackKey: string; videoId: string | null; artist: string; title: string; createdAt: string }>
    > {
      return jsonOr(await fetch('/api/musicvideo/overrides'), []);
    },
    /** One page of recent resolutions, or — with a query — of a search across
     *  every song the server remembers, not merely a filter over that page.
     *  `total` counts everything the query reaches, so the caller can page. */
    async listHistory(
      opts: { query?: string; limit?: number; offset?: number } = {},
    ): Promise<{
      rows: Array<{ trackKey: string; videoId: string | null; miss: boolean; artist: string | null; title: string | null; reason: string | null; resolvedAt: number }>;
      total: number;
      limit: number;
      offset: number;
    }> {
      const params = new URLSearchParams();
      const q = (opts.query ?? '').trim();
      if (q) params.set('q', q);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.offset) params.set('offset', String(opts.offset));
      const qs = params.toString();
      const empty = { rows: [], total: 0, limit: opts.limit ?? 50, offset: opts.offset ?? 0 };
      return jsonOr(await fetch(`/api/musicvideo/history${qs ? `?${qs}` : ''}`), empty);
    },
    /** Returns the parsed body even on a non-2xx — Task 6's error messages are meant to be shown verbatim. */
    async pin(payload: { artist: string; title: string; url: string }): Promise<
      { ok: true; trackKey: string; videoId: string; resolvedTitle: string; durationSec: number } | { ok: false; error: string }
    > {
      const res = await fetch('/api/musicvideo/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, error: body?.error ?? 'Save failed.' };
      return { ok: true, ...body };
    },
    async block(payload: { artist: string; title: string }): Promise<{ ok: true } | { ok: false; error: string }> {
      const res = await fetch('/api/musicvideo/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, block: true }),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, error: body?.error ?? 'Save failed.' };
      return { ok: true };
    },
    async removeOverride(trackKey: string): Promise<void> {
      await ensureOk(
        await fetch(`/api/musicvideo/overrides/${encodeURIComponent(trackKey)}`, { method: 'DELETE' })
      );
    },
  },
  docs: {
    async list(): Promise<{ slug: string; title: string }[]> {
      return jsonOr(await fetch('/api/docs'), []);
    },
    async get(slug: string): Promise<string | null> {
      const res = await fetch(`/api/docs/${encodeURIComponent(slug)}`);
      if (!res.ok) return null;
      return await res.text();
    },
  },
  designs: {
    async list(): Promise<Array<{
      id: string;
      slug: string;
      name: string;
      source: 'builtin' | 'user';
      preview: { colors: string[]; font_family: string | null };
    }>> {
      const res = await fetch('/api/designs');
      if (!res.ok) throw new Error(`GET /api/designs failed: ${res.status}`);
      return (await res.json()) as Array<{
        id: string;
        slug: string;
        name: string;
        source: 'builtin' | 'user';
        preview: { colors: string[]; font_family: string | null };
      }>;
    },
    async get(slug: string): Promise<{
      id: string;
      slug: string;
      name: string;
      source: 'builtin' | 'user';
      content: string;
      frontmatter: Record<string, unknown>;
      body: string;
      parseErrors: string[];
    }> {
      const res = await fetch(`/api/designs/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(`GET /api/designs/${slug} failed: ${res.status}`);
      return (await res.json()) as {
        id: string;
        slug: string;
        name: string;
        source: 'builtin' | 'user';
        content: string;
        frontmatter: Record<string, unknown>;
        body: string;
        parseErrors: string[];
      };
    },
    /** POST /api/designs — create a user pack. Server validates slug + parses content; rejects duplicates with 400. */
    async create(payload: { slug: string; name: string; content: string }): Promise<{
      id: string;
      slug: string;
      name: string;
      source: 'builtin' | 'user';
      content: string;
    }> {
      const res = await fetch('/api/designs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await ensureOk(res);
      return (await res.json()) as {
        id: string;
        slug: string;
        name: string;
        source: 'builtin' | 'user';
        content: string;
      };
    },
    /** PATCH /api/designs/:slug — update name/content of a user pack. 403 on built-ins; slug is immutable. */
    async update(
      slug: string,
      patch: { name?: string; content?: string }
    ): Promise<{ id: string; slug: string; name: string; source: 'builtin' | 'user'; content: string }> {
      const res = await fetch(`/api/designs/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      await ensureOk(res);
      return (await res.json()) as {
        id: string;
        slug: string;
        name: string;
        source: 'builtin' | 'user';
        content: string;
      };
    },
    /** DELETE /api/designs/:slug — remove a user pack. 403 on built-ins. */
    async remove(slug: string): Promise<void> {
      await ensureOk(await fetch(`/api/designs/${encodeURIComponent(slug)}`, { method: 'DELETE' }));
    },
  },
};

export const designs = api.designs;
