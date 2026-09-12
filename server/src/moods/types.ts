import type { AerialClip, AerialMoodConfig } from '../aerials/types.js';

export type MoodStrategy = 'manual' | 'time' | 'weather';

/** Where the mood video comes from: Cosmos's bundled clips, or Apple TV aerials. */
export type MoodSource = 'builtin' | 'aerials';

export interface MoodConfig {
  enabled: boolean;
  /** Default 'builtin' (older configs have no source). */
  source?: MoodSource;
  /** Built-in source only: how the clip is chosen. */
  strategy: MoodStrategy;
  /** Required when strategy === 'manual'. */
  moodId?: string;
  /** Required when strategy === 'weather' (e.g. "weather.home"). */
  weatherEntity?: string;
  /** Aerials source only: which clips and how they rotate. */
  aerials?: AerialMoodConfig;
  /** 0..1. How strongly the mood layer overlays the scene. Default 1. */
  opacity?: number;
}

/**
 * What the display renders. Built-in moods are one looping, screen-blended
 * clip; aerials are a rotating playlist drawn opaque (they are real footage,
 * not glow on black), so the two need different players.
 */
export type ResolvedMood =
  | {
      kind: 'video';
      url: string;
      blend: 'screen' | 'lighten';
      /** 0..1. Multiplied into the layer's effective opacity on the display. */
      opacity: number;
    }
  | {
      kind: 'aerials';
      clips: AerialClip[];
      shuffle: boolean;
      /** Minutes between clips; 0 = when the clip ends. */
      interval_min: number;
      opacity: number;
    };

export interface MoodCatalogEntry {
  id: string;
  label: string;
  /** File name relative to /moods/ on the static server (e.g. "clouds.mp4"). */
  file: string;
  tags: string[];
}
