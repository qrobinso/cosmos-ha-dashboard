import type { Scene, Widget } from '../store/scenes.js';
import type { TransitionDescriptor } from '../transitions/types.js';
import type { ResolvedMood } from '../moods/types.js';

export type ClockData = null;

export type WeatherCurrent = { temp: number; unit: 'C' | 'F'; condition: string; icon: string };
export type WeatherForecastDay = { day: string; high: number; low: number; icon: string };
export type WeatherData = { current: WeatherCurrent; forecast: WeatherForecastDay[] };

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

export type WidgetData =
  | ClockData
  | WeatherData
  | EntityTileData
  | CalendarData
  | MediaPlayerData
  | StatisticsData;

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
