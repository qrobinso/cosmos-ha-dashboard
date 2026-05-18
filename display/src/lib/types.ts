export type Position = { col: number; row: number; w: number; h: number };
export type Layout = { cols: number; rows: number; items: { widget_id: string; col: number; row: number; w: number; h: number }[] };
export type Background =
  | { type: 'solid'; color: string; auto_contrast?: boolean }
  | {
      type: 'gradient';
      colors: string[];
      speed: 'slow' | 'medium' | 'fast';
      style: 'mesh' | 'linear' | 'radial';
      sun_adaptive?: boolean;
      adaptive_colors?: boolean;
      auto_contrast?: boolean;
    };
export type Typography = { font_family: string; font_scale: number; color?: string };
export type WidgetKind = 'clock' | 'weather' | 'entity_tile' | 'calendar' | 'media_player' | 'statistics' | 'text' | 'camera' | 'canvas';

export type WeatherForecastType = 'daily' | 'hourly' | 'twice_daily';

export type WeatherCurrent = {
  temp: number;
  unit: 'C' | 'F';
  condition: string;
  icon?: string;
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

export type WeatherForecastItem = {
  datetime: string;
  condition: string;
  temperature: number;
  templow?: number;
  precipitation?: number;
  precipitation_probability?: number;
  wind_speed?: number;
  wind_bearing?: number | string;
  humidity?: number;
  pressure?: number;
  is_daytime?: boolean;
};

export type WeatherForecastDay = WeatherForecastItem;

export type WeatherData = {
  entity_id: string;
  friendly_name?: string;
  forecast_type: WeatherForecastType;
  current: WeatherCurrent;
  forecast: WeatherForecastItem[];
};

export type EntityState = { entity_id: string; state: string; attributes: Record<string, unknown> };

export type CalendarEvent = {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  all_day: boolean;
  source_id?: string;
  color?: string;
};
export type CalendarSource = {
  id: string;
  entity_id: string;
  label: string;
  color: string;
};
export type CalendarData = {
  entity_id: string;
  friendly_name?: string;
  events: CalendarEvent[];
  sources?: CalendarSource[];
};

export type MediaPlayerData = {
  entity_id: string;
  state: 'playing' | 'paused' | 'idle' | 'on' | 'off' | 'standby' | 'buffering' | 'unknown';
  friendly_name?: string;
  title?: string;
  artist?: string;
  album?: string;
  album_art_url?: string;
  position?: number;
  duration?: number;
  volume?: number;
  muted?: boolean;
  source?: string;
  app?: string;
  supports?: {
    play_pause?: boolean;
    next?: boolean;
    previous?: boolean;
    volume_set?: boolean;
    select_source?: boolean;
  };
};

export type StatisticsPoint = { t: number; v: number };
export type StatisticsData = {
  entity_id: string;
  friendly_name?: string;
  unit?: string;
  current?: number;
  min?: number;
  max?: number;
  points: StatisticsPoint[];
};

export type CameraData = {
  entity_id: string;
  friendly_name: string;
  state: string;
  snapshot_url: string;
  stream_url: string;
  stream_types?: string[];
  available: boolean;
};

export type CanvasData = {
  resolved: string;
  liveEntityIds: string[];
};

export type WidgetData =
  | null
  | WeatherData
  | EntityState
  | CalendarData
  | MediaPlayerData
  | StatisticsData
  | CameraData
  | CanvasData;

export type WidgetState = {
  id: string;
  kind: WidgetKind;
  position: Position;
  config: Record<string, unknown>;
  data: WidgetData;
};

export type MoodStrategy = 'manual' | 'time' | 'weather';
export type MoodConfig = {
  enabled: boolean;
  strategy: MoodStrategy;
  moodId?: string;
  weatherEntity?: string;
  /** 0..1; defaults to 1 when missing. */
  opacity?: number;
};
export type ResolvedMood = { url: string; blend: 'screen' | 'lighten'; opacity: number };

export type CanvasFetchMode = 'off' | 'allowlist' | 'any';
export type CanvasFetchPolicy = { mode: CanvasFetchMode; allowlist: string[] };

export type SceneState = {
  id: string;
  name: string;
  layout: Layout;
  background: Background;
  typography: Typography;
  defaultTransitionId: string | null;
  floatWidgets: boolean;
  mood: MoodConfig;
  widgets: WidgetState[];
  safeArea: { top: number; right: number; bottom: number; left: number };
  resolvedMood?: ResolvedMood;
  /** Entity-state snapshots for every entity any canvas widget on this scene
   *  references (templates + iframe `cosmos.subscribe(...)` requests). The
   *  display merges these into the map forwarded to canvas iframes so
   *  canvases can read entities that aren't bound to any other widget. */
  liveEntities?: EntityState[];
  /** Per-server allowlist policy for canvas-iframe `cosmos.fetch`. Absent
   *  means default (deny everything). */
  canvasFetchPolicy?: CanvasFetchPolicy;
  /** Crossfade duration (ms) for gradient color changes. Server-side
   *  the global transition-speed multiplier scales this; absent → fall
   *  back to a sensible default. */
  gradientFadeMs?: number;
};

export type OverlayMessage = {
  title: string;
  body?: string;
  icon?: string;
  timeout_ms?: number;
};
