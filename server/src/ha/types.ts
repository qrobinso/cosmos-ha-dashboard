import type { Connection } from 'home-assistant-js-websocket';
import type {
  CalendarEvent,
  EntityState,
  StatisticsPoint,
  WeatherForecastItem,
  WeatherForecastType,
} from '../scenes/types.js';

export type { EntityState };

export type StateChangedHandler = (entity: EntityState) => void;

export type HaClient = {
  /** The underlying home-assistant-js-websocket Connection. Used by
   *  TemplatesClient to subscribe to template renders. */
  connection: Connection;
  /** Resolve once the initial state snapshot is loaded. */
  ready(): Promise<void>;
  /** Look up an entity from the local cache; returns null if unknown. */
  getEntity(entityId: string): EntityState | null;
  /** Return all entities currently in the cache. */
  listEntities(): EntityState[];
  /** Subscribe to incremental state changes. Returns an unsubscribe function. */
  onStateChanged(handler: StateChangedHandler): () => void;
  /** Fetch calendar events from a `calendar.*` entity over a time window. */
  getCalendarEvents(
    entityId: string,
    opts: { start: Date; end: Date }
  ): Promise<CalendarEvent[]>;
  /** Fetch state history for a single entity over a time window. */
  getHistory(
    entityId: string,
    opts: { start: Date; end: Date }
  ): Promise<StatisticsPoint[]>;
  /** Fetch a forecast (daily / hourly / twice_daily) for a `weather.*` entity. */
  getWeatherForecasts(
    entityId: string,
    type: WeatherForecastType
  ): Promise<WeatherForecastItem[]>;
  /** Fetch frontend stream types HA supports for a camera entity. */
  getCameraCapabilities(entityId: string): Promise<{ frontend_stream_types: string[] }>;
  /** Fetch a short-lived HLS stream URL for a camera entity. */
  getCameraStream(entityId: string, format?: 'hls'): Promise<{ url: string }>;
  /** Fetch WebRTC peer connection settings for a camera entity. */
  getCameraWebRtcClientConfig(entityId: string): Promise<Record<string, unknown>>;
  /** Send a local ICE candidate to HA for an active WebRTC camera session. */
  addCameraWebRtcCandidate(
    entityId: string,
    sessionId: string,
    candidate: Record<string, unknown>
  ): Promise<void>;
  /** Subscribe to HA's WebRTC offer event stream. */
  subscribeCameraWebRtcOffer(
    entityId: string,
    offer: string,
    handler: (event: unknown) => void
  ): Promise<() => void>;
  /** Disconnect cleanly. */
  close(): Promise<void>;
};
