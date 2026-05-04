import { connectAsync, type MqttClient as RawMqttClient } from 'mqtt';
import type { MqttClient } from './types.js';

export async function makeMqttClient(url: string): Promise<MqttClient> {
  const raw: RawMqttClient = await connectAsync(url);
  const handlers: Array<{ filter: string; handler: (topic: string, payload: string) => void }> = [];

  raw.on('message', (topic, payload) => {
    const str = payload.toString();
    for (const h of handlers) {
      // mqtt's `subscribe` takes care of filter matching at broker level; we still get fired here
      h.handler(topic, str);
    }
  });

  return {
    publish(topic, payload, opts) {
      const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
      raw.publish(topic, str, { retain: opts?.retain ?? false });
    },
    subscribe(filter, handler) {
      handlers.push({ filter, handler });
      raw.subscribe(filter);
    },
    async close() {
      await raw.endAsync();
    },
  };
}
