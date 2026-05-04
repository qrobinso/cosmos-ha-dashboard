import type { Scene, Widget } from '../store/scenes.js';

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

export type WidgetData = ClockData | WeatherData | EntityTileData;

export type WidgetState = Widget & { data: WidgetData };

export type SceneState = Omit<Scene, 'widgets'> & {
  widgets: WidgetState[];
  safeArea: { top: number; right: number; bottom: number; left: number };
};
