import type { FastifyInstance } from 'fastify';

/** Per-(display, widget) set of entity ids the iframe has subscribed to
 *  beyond what the rendered template depends on. The host plumbs the
 *  read function into the assembler so liveEntityIds is the union. */
export type CanvasExtrasStore = {
  add(displayName: string, widgetId: string, entityIds: string[]): void;
  list(displayName: string, widgetId: string): string[];
  /** Union of every entity id this display has subscribed to across ANY
   *  canvas widget. Used by the HA state-change handler to know whether
   *  a state change should re-push the display, even when no widget on
   *  the scene other than a canvas references the entity. */
  entitiesForDisplay(displayName: string): Set<string>;
  /** Drop all extras for the given display (called from the WS hub when
   *  a display disconnects). */
  clearDisplay(displayName: string): void;
};

export function createCanvasExtrasStore(): CanvasExtrasStore {
  // displayName → widgetId → Set<entityId>
  const byDisplay = new Map<string, Map<string, Set<string>>>();
  return {
    add(displayName, widgetId, entityIds) {
      let perDisplay = byDisplay.get(displayName);
      if (!perDisplay) {
        perDisplay = new Map();
        byDisplay.set(displayName, perDisplay);
      }
      let perWidget = perDisplay.get(widgetId);
      if (!perWidget) {
        perWidget = new Set();
        perDisplay.set(widgetId, perWidget);
      }
      for (const id of entityIds) perWidget.add(id);
    },
    list(displayName, widgetId) {
      const perWidget = byDisplay.get(displayName)?.get(widgetId);
      return perWidget ? Array.from(perWidget) : [];
    },
    entitiesForDisplay(displayName) {
      const perDisplay = byDisplay.get(displayName);
      const out = new Set<string>();
      if (!perDisplay) return out;
      for (const set of perDisplay.values()) {
        for (const id of set) out.add(id);
      }
      return out;
    },
    clearDisplay(displayName) {
      byDisplay.delete(displayName);
    },
  };
}

export type CanvasRoutesDeps = {
  extras: CanvasExtrasStore;
  /** Called after an extras update so the host can mark the affected
   *  display dirty and re-push. */
  onExtrasChanged?: (displayName: string) => void;
};

export function registerCanvasRoutes(app: FastifyInstance, deps: CanvasRoutesDeps): void {
  app.post<{
    Params: { widgetId: string };
    Body: { display_name?: unknown; entity_ids?: unknown };
  }>('/api/canvases/:widgetId/subscribe', async (req, reply) => {
    const widgetId = req.params.widgetId;
    const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name : null;
    const entityIds = Array.isArray(req.body?.entity_ids)
      ? req.body!.entity_ids.filter((x: unknown): x is string => typeof x === 'string')
      : null;
    if (!displayName || !entityIds) {
      return reply.code(400).send({ error: 'display_name (string) and entity_ids (string[]) required' });
    }
    deps.extras.add(displayName, widgetId, entityIds);
    deps.onExtrasChanged?.(displayName);
    return reply.code(204).send();
  });
}
