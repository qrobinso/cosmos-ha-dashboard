import type { Connection } from 'home-assistant-js-websocket';

type Sub = { template: string; onMessage: (msg: unknown) => void; onError?: (err: unknown) => void };
type Queued = { result: string; listeners: { entities: string[]; all: boolean; time: boolean } };

export type FakeHaConnection = Connection & {
  queueRenderTemplate(template: string, response: Queued): void;
  pushUpdate(template: string, response: Queued): void;
  countSubscriptions(): number;
};

export function createFakeHaConnection(): FakeHaConnection {
  const queued = new Map<string, Queued[]>();
  const active = new Map<string, Sub[]>();
  let nextId = 1;

  // Minimal Connection surface used by TemplatesClient + tests.
  const conn = {
    addEventListener: () => {},
    removeEventListener: () => {},
    close: () => {},
    sendMessagePromise: async (msg: { type: string; template: string }) => {
      // Cosmos's TemplatesClient uses subscribeMessage, not sendMessagePromise,
      // for render_template. Kept here for completeness.
      void msg;
      return {};
    },
    subscribeMessage: <T>(
      cb: (msg: T) => void,
      msg: { type: string; template: string },
    ) => {
      if (msg.type !== 'render_template') {
        throw new Error(`fake HA: unexpected subscribe type ${msg.type}`);
      }
      const list = active.get(msg.template) ?? [];
      list.push({ template: msg.template, onMessage: cb as (m: unknown) => void });
      active.set(msg.template, list);
      // Flush any queued initial response for this template.
      const q = queued.get(msg.template) ?? [];
      const next = q.shift();
      if (next) (cb as (m: unknown) => void)(next);
      const id = nextId++;
      void id;
      return Promise.resolve((): Promise<void> => {
        const remaining = (active.get(msg.template) ?? []).filter((s) => s.onMessage !== cb);
        if (remaining.length === 0) active.delete(msg.template);
        else active.set(msg.template, remaining);
        return Promise.resolve();
      });
    },
    queueRenderTemplate(template: string, response: Queued) {
      const list = queued.get(template) ?? [];
      list.push(response);
      queued.set(template, list);
    },
    pushUpdate(template: string, response: Queued) {
      const list = active.get(template) ?? [];
      for (const s of list) s.onMessage(response);
    },
    countSubscriptions() {
      let n = 0;
      for (const list of active.values()) n += list.length;
      return n;
    },
  } as unknown as FakeHaConnection;

  return conn;
}
