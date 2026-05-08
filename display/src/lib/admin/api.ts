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
    async list(): Promise<{ id: string; name: string; lastSeen: string | null; defaultSceneId: string | null; currentSceneId: string | null; rotation: { enabled: boolean; sceneIds: string[]; intervalSec: number } | null; orientation: 'landscape' | 'portrait' }[]> {
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
  },
  ha: {
    async listEntities(domain?: string): Promise<{ entity_id: string; state: string; attributes: Record<string, unknown> }[]> {
      const url = domain ? `/api/ha/entities?domain=${encodeURIComponent(domain)}` : '/api/ha/entities';
      return jsonOr(await fetch(url), []);
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
    async getMcpConfig(): Promise<{ enabled: boolean; hasToken: boolean; token: string | null }> {
      const res = await fetch('/api/agent/mcp');
      return (await res.json()) as { enabled: boolean; hasToken: boolean; token: string | null };
    },
    async enableMcp(enabled: boolean): Promise<{ enabled: boolean; hasToken: boolean; token: string | null }> {
      const res = await fetch('/api/agent/mcp/enable', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await ensureOk(res);
      return (await res.json()) as { enabled: boolean; hasToken: boolean; token: string | null };
    },
    async regenerateMcpToken(): Promise<{ enabled: boolean; hasToken: boolean; token: string | null }> {
      const res = await fetch('/api/agent/mcp/regenerate', { method: 'POST' });
      await ensureOk(res);
      return (await res.json()) as { enabled: boolean; hasToken: boolean; token: string | null };
    },
  },
  moods: {
    async list(): Promise<{ id: string; label: string; tags: string[] }[]> {
      return jsonOr(await fetch('/api/moods'), []);
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
};
