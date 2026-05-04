export type Position = { col: number; row: number; w: number; h: number };
export type Layout = { cols: number; rows: number; items: { widget_id: string; col: number; row: number; w: number; h: number }[] };
export type Background =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; colors: string[]; speed: 'slow' | 'medium' | 'fast'; style: 'mesh' | 'linear' | 'radial' };
export type Typography = { font_family: string; font_scale: number };
export type WidgetKind = 'clock' | 'weather' | 'entity_tile';

export type WeatherCurrent = { temp: number; unit: 'C' | 'F'; condition: string; icon: string };
export type WeatherForecastDay = { day: string; high: number; low: number; icon: string };
export type WeatherData = { current: WeatherCurrent; forecast: WeatherForecastDay[] };

export type EntityState = { entity_id: string; state: string; attributes: Record<string, unknown> };

export type WidgetData = null | WeatherData | EntityState;

export type WidgetState = {
  id: string;
  kind: WidgetKind;
  position: Position;
  config: Record<string, unknown>;
  data: WidgetData;
};

export type SceneState = {
  id: string;
  name: string;
  layout: Layout;
  background: Background;
  typography: Typography;
  widgets: WidgetState[];
  safeArea: { top: number; right: number; bottom: number; left: number };
};
