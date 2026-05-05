// home-assistant-js-websocket reads globalThis.WebSocket. In Node 20 that
// global isn't defined (it's experimental), so we polyfill with ws before
// the library is loaded. Node 22+ has WebSocket as a stable global; this
// polyfill becomes a no-op once we move off Node 20.
import { WebSocket as WsWebSocket } from 'ws';
const g = globalThis as unknown as { WebSocket?: typeof WsWebSocket };
if (typeof g.WebSocket === 'undefined') {
  g.WebSocket = WsWebSocket;
}

import {
  callService,
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  type Connection,
} from 'home-assistant-js-websocket';
import type { HaClient, EntityState, StateChangedHandler } from './types.js';
import type { CalendarEvent, StatisticsPoint } from '../scenes/types.js';
import { createEntityCache } from './cache.js';

export type HaConfig = {
  url: string;       // e.g. http://homeassistant.local:8123
  token: string;     // long-lived access token
};

type HaCalendarEvent = {
  summary?: string;
  description?: string;
  location?: string;
  start?: string | { dateTime?: string; date?: string };
  end?: string | { dateTime?: string; date?: string };
};

function normalizeCalendarEvent(raw: HaCalendarEvent): CalendarEvent | null {
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  if (!summary) return null;
  const startVal = typeof raw.start === 'string' ? raw.start : raw.start?.dateTime ?? raw.start?.date;
  const endVal = typeof raw.end === 'string' ? raw.end : raw.end?.dateTime ?? raw.end?.date;
  if (!startVal || !endVal) return null;
  // HA returns date-only strings (YYYY-MM-DD) for all-day events.
  const allDay =
    /^\d{4}-\d{2}-\d{2}$/.test(startVal) ||
    (typeof raw.start === 'object' && raw.start !== null && 'date' in raw.start && !raw.start.dateTime);
  return {
    summary,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    location: typeof raw.location === 'string' ? raw.location : undefined,
    start: allDay ? new Date(startVal + 'T00:00:00').toISOString() : new Date(startVal).toISOString(),
    end: allDay ? new Date(endVal + 'T00:00:00').toISOString() : new Date(endVal).toISOString(),
    all_day: allDay,
  };
}

export async function makeHaClient(config: HaConfig): Promise<HaClient> {
  const cache = createEntityCache();
  const auth = createLongLivedTokenAuth(config.url, config.token);
  let connection: Connection | null = null;

  let readyResolve!: () => void;
  const readyPromise = new Promise<void>((r) => (readyResolve = r));
  let firstSnapshotReceived = false;

  connection = await createConnection({ auth });

  const unsubscribe = subscribeEntities(connection, (entities) => {
    const list: EntityState[] = Object.values(entities).map((e) => ({
      entity_id: e.entity_id,
      state: String(e.state),
      attributes: { ...e.attributes },
    }));
    cache.setMany(list);
    if (!firstSnapshotReceived) {
      firstSnapshotReceived = true;
      readyResolve();
    } else {
      for (const e of list) cache.emitChange(e);
    }
  });

  async function getCalendarEvents(
    entityId: string,
    opts: { start: Date; end: Date }
  ): Promise<CalendarEvent[]> {
    if (!connection) return [];
    try {
      // HA's `calendar.get_events` service returns events in `response.<entity_id>.events`.
      const result = (await callService(
        connection,
        'calendar',
        'get_events',
        { start_date_time: opts.start.toISOString(), end_date_time: opts.end.toISOString() },
        { entity_id: entityId },
        true
      )) as { response?: Record<string, { events?: HaCalendarEvent[] }> } | undefined;
      const raw = result?.response?.[entityId]?.events ?? [];
      return raw
        .map(normalizeCalendarEvent)
        .filter((e): e is CalendarEvent => e !== null)
        .sort((a, b) => a.start.localeCompare(b.start));
    } catch (err) {
      console.error(`HA calendar.get_events failed for ${entityId}`, err);
      return [];
    }
  }

  async function getHistory(
    entityId: string,
    opts: { start: Date; end: Date }
  ): Promise<StatisticsPoint[]> {
    if (!connection) return [];
    try {
      const result = (await connection.sendMessagePromise({
        type: 'history/history_during_period',
        start_time: opts.start.toISOString(),
        end_time: opts.end.toISOString(),
        entity_ids: [entityId],
        minimal_response: true,
        no_attributes: true,
      })) as Record<string, Array<{ s?: string; lu?: number }>> | undefined;
      const series = result?.[entityId] ?? [];
      const points: StatisticsPoint[] = [];
      for (const sample of series) {
        const v = Number(sample.s);
        if (!Number.isFinite(v)) continue;
        const t = typeof sample.lu === 'number' ? sample.lu * 1000 : 0;
        if (!t) continue;
        points.push({ t, v });
      }
      return points;
    } catch (err) {
      console.error(`HA history fetch failed for ${entityId}`, err);
      return [];
    }
  }

  return {
    ready: () => readyPromise,
    getEntity: (id) => cache.get(id),
    listEntities: () => cache.list(),
    onStateChanged: (h: StateChangedHandler) => cache.onChange(h),
    getCalendarEvents,
    getHistory,
    close: async () => {
      unsubscribe();
      connection?.close();
    },
  };
}
