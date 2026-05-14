import type { Connection } from 'home-assistant-js-websocket';
import type { HaClient, EntityState, StateChangedHandler } from './types.js';
import type {
  CalendarEvent,
  StatisticsPoint,
  WeatherForecastItem,
  WeatherForecastType,
} from '../scenes/types.js';
import { createEntityCache } from './cache.js';

/** A fake HA client backed by the entity cache. Tests seed it with `set()` and emit changes with `emit()`. */
export type FakeHaClient = HaClient & {
  set(entity: EntityState): void;
  setMany(entities: EntityState[]): void;
  emit(entity: EntityState): void;
  setCalendarEvents(entityId: string, events: CalendarEvent[]): void;
  setHistory(entityId: string, points: StatisticsPoint[]): void;
  setWeatherForecasts(entityId: string, type: WeatherForecastType, forecast: WeatherForecastItem[]): void;
  setCameraCapabilities(entityId: string, streamTypes: string[]): void;
};

export function createFakeHaClient(initial: EntityState[] = []): FakeHaClient {
  const cache = createEntityCache();
  cache.setMany(initial);
  const calendars = new Map<string, CalendarEvent[]>();
  const histories = new Map<string, StatisticsPoint[]>();
  const forecasts = new Map<string, WeatherForecastItem[]>(); // key: `${entityId}:${type}`
  const cameraCapabilities = new Map<string, string[]>();
  return {
    // Fake clients don't need a real Connection; tests that use TemplatesClient
    // should supply their own fake. Cast to satisfy the HaClient interface.
    connection: null as unknown as Connection,
    ready: async () => {},
    getEntity: (id) => cache.get(id),
    listEntities: () => cache.list(),
    onStateChanged: (h: StateChangedHandler) => cache.onChange(h),
    getCalendarEvents: async (id) => calendars.get(id) ?? [],
    getHistory: async (id) => histories.get(id) ?? [],
    getWeatherForecasts: async (id, type) => forecasts.get(`${id}:${type}`) ?? [],
    getCameraCapabilities: async (id) => ({ frontend_stream_types: cameraCapabilities.get(id) ?? [] }),
    getCameraStream: async (id) => ({ url: `/api/hls/fake-${encodeURIComponent(id)}/playlist.m3u8` }),
    getCameraWebRtcClientConfig: async () => ({ configuration: {} }),
    addCameraWebRtcCandidate: async () => {},
    subscribeCameraWebRtcOffer: async () => () => {},
    close: async () => {},
    set: (e) => cache.set(e),
    setMany: (es) => cache.setMany(es),
    emit: (e) => cache.emitChange(e),
    setCalendarEvents: (id, events) => calendars.set(id, events),
    setHistory: (id, points) => histories.set(id, points),
    setWeatherForecasts: (id, type, f) => forecasts.set(`${id}:${type}`, f),
    setCameraCapabilities: (id, streamTypes) => cameraCapabilities.set(id, streamTypes),
  };
}
