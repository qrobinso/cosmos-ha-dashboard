import type { MqttClient } from './types.js';

export type FakeMqttClient = MqttClient & {
  /** All published messages, in order. */
  published: Array<{ topic: string; payload: string; retain: boolean }>;
  /** Manually invoke any subscribed handlers as if a broker delivered the message. */
  inject(topic: string, payload: string): void;
};

export function createFakeMqttClient(): FakeMqttClient {
  const subscriptions = new Map<string, ((topic: string, payload: string) => void)[]>();
  const published: FakeMqttClient['published'] = [];

  function topicMatches(filter: string, topic: string): boolean {
    if (filter === topic) return true;
    if (!filter.includes('+') && !filter.includes('#')) return false;
    const f = filter.split('/');
    const t = topic.split('/');
    for (let i = 0; i < f.length; i++) {
      const fp = f[i];
      if (fp === '#') return true;
      if (fp === '+') {
        if (t[i] === undefined) return false;
        continue;
      }
      if (fp !== t[i]) return false;
    }
    return f.length === t.length;
  }

  return {
    publish(topic, payload, opts) {
      const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
      published.push({ topic, payload: str, retain: opts?.retain ?? false });
    },
    subscribe(topic, handler) {
      const list = subscriptions.get(topic) ?? [];
      list.push(handler);
      subscriptions.set(topic, list);
    },
    close: async () => {},
    published,
    inject(topic, payload) {
      for (const [filter, handlers] of subscriptions) {
        if (!topicMatches(filter, topic)) continue;
        for (const h of handlers) h(topic, payload);
      }
    },
  };
}
