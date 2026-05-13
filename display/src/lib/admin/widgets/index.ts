// Map a widget kind to its per-kind config component.
import type { ComponentType } from 'svelte';
import type { WidgetKind } from '$lib/types';
import ClockConfig from './ClockConfig.svelte';
import WeatherConfig from './WeatherConfig.svelte';
import EntityTileConfig from './EntityTileConfig.svelte';
import CalendarConfig from './CalendarConfig.svelte';
import MediaPlayerConfig from './MediaPlayerConfig.svelte';
import StatisticsConfig from './StatisticsConfig.svelte';
import TextConfig from './TextConfig.svelte';
import CameraConfig from './CameraConfig.svelte';
import CanvasConfig from './CanvasConfig.svelte';

export const configComponents: Record<WidgetKind, ComponentType> = {
  clock: ClockConfig,
  weather: WeatherConfig,
  entity_tile: EntityTileConfig,
  calendar: CalendarConfig,
  media_player: MediaPlayerConfig,
  statistics: StatisticsConfig,
  text: TextConfig,
  camera: CameraConfig,
  canvas: CanvasConfig,
};
