import type { FastifyInstance } from 'fastify';
import type { CalendarCache } from '../ha/calendarCache.js';
import { mockCalendar } from '../scenes/mockData.js';
import type { CalendarEvent } from '../scenes/types.js';

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
  /** Drop extras for any widget id NOT in `keepWidgetIds` for this display.
   *  Called on every scene push so when a display switches to a scene
   *  without a given canvas (or with a different one), the iframe-side
   *  subscriptions for the gone canvas don't keep forcing re-pushes. */
  pruneDisplay(displayName: string, keepWidgetIds: Iterable<string>): void;
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
    pruneDisplay(displayName, keepWidgetIds) {
      const perDisplay = byDisplay.get(displayName);
      if (!perDisplay) return;
      const keep = keepWidgetIds instanceof Set ? keepWidgetIds : new Set(keepWidgetIds);
      for (const id of perDisplay.keys()) {
        if (!keep.has(id)) perDisplay.delete(id);
      }
      if (perDisplay.size === 0) byDisplay.delete(displayName);
    },
  };
}

export type CanvasRoutesDeps = {
  extras: CanvasExtrasStore;
  /** Called after an extras update so the host can mark the affected
   *  display dirty and re-push. */
  onExtrasChanged?: (displayName: string) => void;
  /** Calendar cache used by `GET /api/canvases/:widgetId/calendar-events`.
   *  Absent when HA is disabled — the route then falls back to mock fixtures
   *  filtered to the requested window, matching the native widget's posture. */
  calendarCache?: CalendarCache | null;
};

function isIsoLike(s: unknown): s is string {
  if (typeof s !== 'string' || s.length < 10) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function filterEventsToWindow(events: CalendarEvent[], start: Date, end: Date): CalendarEvent[] {
  return events.filter((e) => {
    const evStart = new Date(e.start).getTime();
    const evEnd = new Date(e.end).getTime();
    return evEnd >= start.getTime() && evStart <= end.getTime();
  });
}

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

  app.get<{
    Params: { widgetId: string };
    Querystring: { entity_id?: string; start?: string; end?: string };
  }>('/api/canvases/:widgetId/calendar-events', async (req, reply) => {
    const entityId = typeof req.query.entity_id === 'string' ? req.query.entity_id.trim() : '';
    const startIso = typeof req.query.start === 'string' ? req.query.start : '';
    const endIso = typeof req.query.end === 'string' ? req.query.end : '';
    if (!entityId) return reply.code(400).send({ error: 'entity_id required' });
    if (!isIsoLike(startIso)) return reply.code(400).send({ error: 'start must be an ISO datetime' });
    if (!isIsoLike(endIso)) return reply.code(400).send({ error: 'end must be an ISO datetime' });
    const startDate = new Date(startIso);
    const endDate = new Date(endIso);
    if (endDate.getTime() <= startDate.getTime()) {
      return reply.code(400).send({ error: 'end must be after start' });
    }
    if (!deps.calendarCache) {
      // HA disabled — return mock fixtures filtered to the window so canvas
      // authoring stays usable in dev / mock mode (mirrors the assembler).
      const events = filterEventsToWindow(mockCalendar(entityId).events, startDate, endDate);
      return reply.send({ events });
    }
    try {
      const events = await deps.calendarCache.get(entityId, startIso, endIso);
      return reply.send({ events });
    } catch {
      // The HA client method already swallows + logs; this catches anything
      // upstream of it (cache rejection, etc). Never 500 — surface an empty
      // window the canvas can render rather than crashing the iframe.
      return reply.send({ events: [] });
    }
  });
}
