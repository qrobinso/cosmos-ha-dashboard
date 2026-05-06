import type { Scene, Widget } from '../store/scenes.js';
import type { TransitionDescriptor } from '../transitions/types.js';
import type { ResolvedMood } from '../moods/types.js';

export type ClockData = null;

/** HA weather forecast types — mirrors the `forecast_type` field of HA's
 *  weather-forecast lovelace card and the `type` parameter of the
 *  `weather.get_forecasts` service. */
export type WeatherForecastType = 'daily' | 'hourly' | 'twice_daily';

/** Current conditions, sourced from the weather entity's state + attributes. */
export type WeatherCurrent = {
  /** Numeric temperature reading. */
  temp: number;
  /** 'C' or 'F'. Derived from the entity's `temperature_unit`. */
  unit: 'C' | 'F';
  /** HA condition string: 'sunny', 'cloudy', 'partlycloudy', 'rainy', 'snowy', etc. */
  condition: string;
  /** Optional iconography hint (legacy field — display widget can fall back to condition). */
  icon?: string;

  // ── Extended attributes used by `secondary_info_attribute` ──
  humidity?: number;
  pressure?: number;
  wind_speed?: number;
  wind_bearing?: number | string;
  visibility?: number;
  cloud_coverage?: number;
  uv_index?: number;
  apparent_temperature?: number;
  dew_point?: number;
};

/** A single forecast item. Different forecast types use different fields. */
export type WeatherForecastItem = {
  /** ISO datetime — the slot the forecast applies to. */
  datetime: string;
  condition: string;
  /** For daily forecasts, this is the high temp; for hourly, the temp at that hour. */
  temperature: number;
  /** Daily forecasts include a low; hourly typically does not. */
  templow?: number;
  precipitation?: number;
  precipitation_probability?: number;
  wind_speed?: number;
  wind_bearing?: number | string;
  humidity?: number;
  pressure?: number;
  /** Twice-daily forecasts use this to mark day vs night halves. */
  is_daytime?: boolean;
};

/** Backwards-compat alias for older shapes/widgets. */
export type WeatherForecastDay = WeatherForecastItem;

export type WeatherData = {
  /** Source weather entity. Empty when no entity configured (mock fallback). */
  entity_id: string;
  /** Friendly name from the entity, or override from widget config. */
  friendly_name?: string;
  /** Which forecast type was requested. Useful for the widget's UX. */
  forecast_type: WeatherForecastType;
  current: WeatherCurrent;
  forecast: WeatherForecastItem[];
};

export type EntityState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
};
export type EntityTileData = EntityState;

/** Calendar agenda — mirrors the shape HA's `calendar.get_events` returns. */
export type CalendarEvent = {
  summary: string;
  description?: string;
  location?: string;
  /** ISO-8601 datetime. For all-day events, this is a date with start-of-day. */
  start: string;
  /** ISO-8601 datetime. For all-day events, exclusive end-of-day. */
  end: string;
  all_day: boolean;
};
export type CalendarData = {
  /** entity_id of the source calendar (for friendly-name lookups). */
  entity_id: string;
  friendly_name?: string;
  events: CalendarEvent[];
};

/** Media player — mirrors HA `media_player.*` attributes. */
export type MediaPlayerData = {
  entity_id: string;
  state: 'playing' | 'paused' | 'idle' | 'on' | 'off' | 'standby' | 'buffering' | 'unknown';
  friendly_name?: string;
  title?: string;
  artist?: string;
  album?: string;
  album_art_url?: string;
  /** seconds */
  position?: number;
  /** seconds */
  duration?: number;
  /** 0..1 */
  volume?: number;
  muted?: boolean;
  source?: string;
  /** App reporting playback (e.g. "Spotify"). */
  app?: string;
  supports?: {
    play_pause?: boolean;
    next?: boolean;
    previous?: boolean;
    volume_set?: boolean;
    select_source?: boolean;
  };
};

/** Statistics / history graph — sparkline series. */
export type StatisticsPoint = {
  /** Unix epoch milliseconds. */
  t: number;
  v: number;
};
export type StatisticsData = {
  entity_id: string;
  friendly_name?: string;
  unit?: string;
  current?: number;
  min?: number;
  max?: number;
  points: StatisticsPoint[];
};

/** Camera feed — mirrors HA's picture-glance / camera card config. The
 *  stream / snapshot URLs are routed through Cosmos's `/api/ha-media` proxy
 *  so the browser doesn't need a HA token (or even network reachability to
 *  HA — the server fetches and streams the bytes). */
export type CameraData = {
  entity_id: string;
  friendly_name: string;
  /** State at scene-assembly time (idle/recording/streaming). The widget
   *  doesn't reactively re-push on state changes — this is a snapshot. */
  state: string;
  /** Single-frame JPEG via HA's `camera_proxy` endpoint. */
  snapshot_url: string;
  /** MJPEG stream via HA's `camera_proxy_stream` endpoint. */
  stream_url: string;
  /** False when the camera entity isn't in HA's cache (e.g. unavailable). */
  available: boolean;
};

export type CanvasData = {
  /** Content with Jinja templates already substituted by HA. */
  resolved: string;
  /** Entity ids the rendered template depends on, plus any iframe-side
   *  subscriptions registered via POST /api/canvases/:widgetId/subscribe. */
  liveEntityIds: string[];
};

export type WidgetData =
  | ClockData
  | WeatherData
  | EntityTileData
  | CalendarData
  | MediaPlayerData
  | StatisticsData
  | CameraData
  | CanvasData;

export type WidgetState = Widget & { data: WidgetData };

export type SceneState = Omit<Scene, 'widgets'> & {
  widgets: WidgetState[];
  safeArea: { top: number; right: number; bottom: number; left: number };
  /** Resolved mood for the active period; absent when the scene's mood is off
   *  or its strategy can't resolve (e.g. weather entity not yet known). */
  resolvedMood?: ResolvedMood;
};

export type ScenePushPayload = {
  type: 'scene';
  state: SceneState;
  transition?: TransitionDescriptor;
};
