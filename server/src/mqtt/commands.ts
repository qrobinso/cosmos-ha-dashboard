import type { ParsedCommand } from './types.js';

const TOPIC_RE = /^cosmos\/([^/]+)\/(message\/set|message\/dismiss|scene\/set)$/;

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
  }
  return null;
}
