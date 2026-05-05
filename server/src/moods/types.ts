export type MoodStrategy = 'manual' | 'time' | 'weather';

export interface MoodConfig {
  enabled: boolean;
  strategy: MoodStrategy;
  /** Required when strategy === 'manual'. */
  moodId?: string;
  /** Required when strategy === 'weather' (e.g. "weather.home"). */
  weatherEntity?: string;
  /** 0..1. How strongly the mood layer overlays the scene. Default 1. */
  opacity?: number;
}

export interface ResolvedMood {
  url: string;
  blend: 'screen' | 'lighten';
  /** 0..1. Multiplied into the layer's effective opacity on the display. */
  opacity: number;
}

export interface MoodCatalogEntry {
  id: string;
  label: string;
  /** File name relative to /moods/ on the static server (e.g. "clouds.mp4"). */
  file: string;
  tags: string[];
}
