export type MoodStrategy = 'manual' | 'time' | 'weather';

export interface MoodConfig {
  enabled: boolean;
  strategy: MoodStrategy;
  /** Required when strategy === 'manual'. */
  moodId?: string;
  /** Required when strategy === 'weather' (e.g. "weather.home"). */
  weatherEntity?: string;
}

export interface ResolvedMood {
  url: string;
  blend: 'screen' | 'lighten';
}

export interface MoodCatalogEntry {
  id: string;
  label: string;
  /** File name relative to /moods/ on the static server (e.g. "clouds.mp4"). */
  file: string;
  tags: string[];
}
