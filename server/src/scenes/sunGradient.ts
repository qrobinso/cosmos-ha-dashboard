import type { EntityState } from './types.js';
import { timeOfDay } from '../moods/resolve.js';
import type { TimeOfDay } from '../moods/catalog.js';

/**
 * Built-in gradient palettes used by sun-adaptive backgrounds. One palette
 * per time-of-day bucket. The keys match the `TimeOfDay` union exported
 * from the mood engine, so the same `sun.sun`-aware bucketing applies.
 */
export const SUN_GRADIENT_PRESETS: Record<TimeOfDay, string[]> = {
  // Warm dawn — peachy/orange/blue mix.
  sunrise: ['#ff6e7f', '#bfe9ff', '#ffb88c', '#ff5f6d'],
  // Bright peach glow for midday.
  day:     ['#ffecd2', '#fcb69f', '#ff9a9e', '#fad0c4'],
  // Lavender haze for dusk.
  evening: ['#3a1c71', '#6a3093', '#a044ff', '#d76d77'],
  // Deep midnight blue for the small hours.
  night:   ['#1a1a2e', '#16213e', '#0f3460'],
};

/**
 * Resolve the active gradient palette based on `sun.sun` (or the local-time
 * fallback when HA isn't connected). Mirrors the bucketing used by the
 * time-of-day mood strategy so the background and mood stay in lockstep.
 */
export function resolveSunGradient(now: Date, sun: EntityState | null): string[] {
  const bucket = timeOfDay(now, sun);
  return SUN_GRADIENT_PRESETS[bucket];
}
