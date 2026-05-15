import type { ParsedCommand } from './types.js';

const TOPIC_RE = /^cosmos\/([^/]+)\/(message\/set|message\/dismiss|scene\/set|scene\/last|scene\/alert)$/;

export function parseCommandTopic(topic: string, payload: string): ParsedCommand | null {
  const m = TOPIC_RE.exec(topic);
  if (!m) return null;
  const [, target, action] = m;
  switch (action) {
    case 'message/set': {
      let body: unknown;
      try {
        body = JSON.parse(payload);
      } catch {
        return null;
      }
      if (typeof body !== 'object' || body === null) return null;
      const b = body as Record<string, unknown>;
      if (typeof b.title !== 'string' || b.title.trim() === '') return null;
      return {
        kind: 'show_message',
        target,
        message: {
          title: b.title,
          body: typeof b.body === 'string' ? b.body : undefined,
          icon: typeof b.icon === 'string' ? b.icon : undefined,
          timeout_ms: typeof b.timeout_ms === 'number' ? b.timeout_ms : undefined,
        },
      };
    }
    case 'message/dismiss':
      return { kind: 'dismiss_message', target };
    case 'scene/set': {
      let body: unknown;
      try {
        body = JSON.parse(payload);
      } catch {
        return null;
      }
      if (typeof body !== 'object' || body === null) return null;
      const b = body as Record<string, unknown>;
      if (typeof b.scene_name !== 'string' || b.scene_name.trim() === '') return null;
      return { kind: 'show_scene', target, sceneName: b.scene_name };
    }
    case 'scene/last':
      // No payload required — switches to whichever scene was active before
      // the current one. Useful as an HA automation action ("go back").
      return { kind: 'last_scene', target };
    case 'scene/alert': {
      let body: unknown;
      try {
        body = JSON.parse(payload);
      } catch {
        return null;
      }
      if (typeof body !== 'object' || body === null) return null;
      const b = body as Record<string, unknown>;
      if (typeof b.scene_name !== 'string' || b.scene_name.trim() === '') return null;
      if (typeof b.dwell_ms !== 'number' || !isFinite(b.dwell_ms)) return null;
      return {
        kind: 'show_scene_alert',
        target,
        sceneName: b.scene_name,
        dwellMs: b.dwell_ms,
        transitionId: typeof b.transition_id === 'string' ? b.transition_id : undefined,
      };
    }
  }
  return null;
}
