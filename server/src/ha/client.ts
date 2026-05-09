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
import type {
  CalendarEvent,
  StatisticsPoint,
  WeatherForecastItem,
  WeatherForecastType,
} from '../scenes/types.js';
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

  /** Cache weather forecasts so we don't fire `weather.get_forecasts` on
   *  every scene push. HA forecasts update every 10–30 min in practice;
   *  refreshing every 5 minutes is plenty fresh for a wall display, and
   *  it eliminates the call storm that used to swamp the HA WS during
   *  bursts of scene re-pushes (one forecast call per push per weather
   *  widget). The cache also coalesces concurrent in-flight requests for
   *  the same (entity, type) into a single network call. Cleared keys
   *  fall through to the upstream call. */
  const FORECAST_TTL_MS = 5 * 60 * 1000;
  type ForecastCacheEntry = {
    expires: number;
    promise: Promise<WeatherForecastItem[]>;
  };
  const forecastCache = new Map<string, ForecastCacheEntry>();

  async function fetchForecastsUncached(
    entityId: string,
    type: WeatherForecastType
  ): Promise<WeatherForecastItem[]> {
    if (!connection) return [];
    try {
      const result = (await callService(
        connection,
        'weather',
        'get_forecasts',
        { type },
        { entity_id: entityId },
        true
      )) as { response?: Record<string, { forecast?: WeatherForecastItem[] }> } | undefined;
      const raw = result?.response?.[entityId]?.forecast ?? [];
      return raw.map((f) => ({
        datetime: typeof f.datetime === 'string' ? f.datetime : new Date().toISOString(),
        condition: typeof f.condition === 'string' ? f.condition : 'unknown',
        temperature: typeof f.temperature === 'number' ? f.temperature : 0,
        templow: typeof f.templow === 'number' ? f.templow : undefined,
        precipitation: typeof f.precipitation === 'number' ? f.precipitation : undefined,
        precipitation_probability:
          typeof f.precipitation_probability === 'number' ? f.precipitation_probability : undefined,
        wind_speed: typeof f.wind_speed === 'number' ? f.wind_speed : undefined,
        wind_bearing:
          typeof f.wind_bearing === 'number' || typeof f.wind_bearing === 'string'
            ? f.wind_bearing
            : undefined,
        humidity: typeof f.humidity === 'number' ? f.humidity : undefined,
        pressure: typeof f.pressure === 'number' ? f.pressure : undefined,
        is_daytime: typeof f.is_daytime === 'boolean' ? f.is_daytime : undefined,
      }));
    } catch (err) {
      console.error(`HA weather.get_forecasts failed for ${entityId}`, err);
      return [];
    }
  }

  async function getWeatherForecasts(
    entityId: string,
    type: WeatherForecastType
  ): Promise<WeatherForecastItem[]> {
    const key = `${entityId}|${type}`;
    const now = Date.now();
    const cached = forecastCache.get(key);
    if (cached && cached.expires > now) return cached.promise;
    const promise = fetchForecastsUncached(entityId, type);
    forecastCache.set(key, { expires: now + FORECAST_TTL_MS, promise });
    // If the upstream call rejected (which shouldn't happen — we catch and
    // return [] inside fetchForecastsUncached — but defensively), drop the
    // cache entry so the next caller can retry instead of being stuck on
    // a permanently-rejected promise.
    promise.catch(() => forecastCache.delete(key));
    return promise;
  }

  return {
    connection,
    ready: () => readyPromise,
    getEntity: (id) => cache.get(id),
    listEntities: () => cache.list(),
    onStateChanged: (h: StateChangedHandler) => cache.onChange(h),
    getCalendarEvents,
    getHistory,
    getWeatherForecasts,
    close: async () => {
      unsubscribe();
      connection?.close();
    },
  };
}
