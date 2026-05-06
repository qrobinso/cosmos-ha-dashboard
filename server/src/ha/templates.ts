import type { Connection } from 'home-assistant-js-websocket';

export type TemplateRender = {
  initial: string;
  entityIds: string[];
  unsubscribe: () => void;
};

export type TemplatesClient = {
  /** Render a template via HA and subscribe for updates. Multiple callers
   *  requesting the same template string share one underlying HA
   *  subscription (ref-counted). The returned `unsubscribe` decrements
   *  the count; the HA subscription closes when the count hits zero. */
  render(
    template: string,
    onUpdate: (rendered: string, entityIds: string[]) => void,
  ): Promise<TemplateRender>;
  close(): void;
};

type Shared = {
  template: string;
  callbacks: Set<(rendered: string, entityIds: string[]) => void>;
  haUnsubscribe: () => Promise<void>;
  lastResult: string;
  lastEntityIds: string[];
};

type RenderTemplateMsg = {
  result?: string;
  error?: string;
  listeners?: { entities?: string[]; all?: boolean; time?: boolean };
};

export function createTemplatesClient(conn: Connection): TemplatesClient {
  const shared = new Map<string, Shared>();
  let closed = false;

  async function ensure(template: string): Promise<Shared> {
    const existing = shared.get(template);
    if (existing) return existing;

    let resolveFirst: (s: Shared) => void;
    let rejectFirst: (err: unknown) => void;
    const firstPromise = new Promise<Shared>((res, rej) => {
      resolveFirst = res;
      rejectFirst = rej;
    });

    let initialised = false;
    let entry: Shared | null = null;

    const handler = (msg: RenderTemplateMsg) => {
      const result = typeof msg.result === 'string' ? msg.result : (msg.error ?? '');
      const entityIds = msg.listeners?.entities ?? [];
      if (!initialised) {
        initialised = true;
        const haUnsubscribe = pendingUnsubscribe ?? (() => Promise.resolve());
        const e: Shared = {
          template,
          callbacks: new Set(),
          haUnsubscribe,
          lastResult: result,
          lastEntityIds: entityIds,
        };
        entry = e;
        shared.set(template, e);
        resolveFirst(e);
        return;
      }
      if (!entry) return;
      entry.lastResult = result;
      entry.lastEntityIds = entityIds;
      for (const cb of entry.callbacks) cb(result, entityIds);
    };

    let pendingUnsubscribe: (() => Promise<void>) | null = null;
    try {
      pendingUnsubscribe = await conn.subscribeMessage<RenderTemplateMsg>(handler, {
        type: 'render_template',
        template,
      });
    } catch (err) {
      rejectFirst!(err);
      throw err;
    }
    // If the handler already fired synchronously (some fakes do), `entry` is set.
    if (entry) (entry as Shared).haUnsubscribe = pendingUnsubscribe;
    return firstPromise;
  }

  return {
    async render(template, onUpdate) {
      if (closed) throw new Error('TemplatesClient closed');
      const entry = await ensure(template);
      entry.callbacks.add(onUpdate);
      return {
        initial: entry.lastResult,
        entityIds: entry.lastEntityIds,
        unsubscribe: () => {
          entry.callbacks.delete(onUpdate);
          if (entry.callbacks.size === 0) {
            void entry.haUnsubscribe();
            shared.delete(template);
          }
        },
      };
    },
    close() {
      closed = true;
      for (const e of shared.values()) void e.haUnsubscribe();
      shared.clear();
    },
  };
}
