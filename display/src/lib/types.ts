export type Position = { col: number; row: number; w: number; h: number };
export type Layout = { cols: number; rows: number; items: { widget_id: string; col: number; row: number; w: number; h: number }[] };
export type Background =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; colors: string[]; speed: 'slow' | 'medium' | 'fast'; style: 'mesh' | 'linear' | 'radial' };
export type Typography = { font_family: string; font_scale: number };
export type WidgetKind = 'clock' | 'weather' | 'entity_tile' | 'calendar' | 'media_player' | 'statistics' | 'text';

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
};
export type CalendarData = {
  entity_id: string;
  friendly_name?: string;
  events: CalendarEvent[];
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

export type WidgetData =
  | null
  | WeatherData
  | EntityState
  | CalendarData
  | MediaPlayerData
  | StatisticsData;

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
};

export type OverlayMessage = {
  title: string;
  body?: string;
  icon?: string;
  timeout_ms?: number;
};
