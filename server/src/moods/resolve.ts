import type { EntityState } from '../scenes/types.js';
import type { MoodConfig, ResolvedMood } from './types.js';
import { TIME_TO_MOOD, WEATHER_TO_MOOD, type TimeOfDay } from './catalog.js';

export type ResolveContext = {
  now: Date;
  /** Returns the current state for an entity, or null if not present. */
  readEntity: (entityId: string) => EntityState | null;
};

const DEFAULT_BLEND: ResolvedMood['blend'] = 'screen';

function clampOpacity(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

function buildResolved(moodId: string, opacity: number): ResolvedMood | null {
  if (!moodId || /[\\/]/.test(moodId)) return null;
  return { url: `/moods/${moodId}.mp4`, blend: DEFAULT_BLEND, opacity };
}

/**
 * Map a Date to one of four time-of-day buckets using HA's `sun.sun` entity
 * when available, falling back to a clock-only heuristic.
 *
 * Sun-aware logic: within ±45min of sunrise → 'sunrise'; within ±45min of
 * sunset → 'evening'; otherwise the entity's `state` decides
 * ('above_horizon' → 'day', 'below_horizon' → 'night').
 */
export function timeOfDay(now: Date, sun: EntityState | null): TimeOfDay {
  const WINDOW_MS = 45 * 60 * 1000;
  if (sun) {
    const a = sun.attributes as Record<string, unknown>;
    const rising = typeof a.next_rising === 'string' ? Date.parse(a.next_rising) : NaN;
    const setting = typeof a.next_setting === 'string' ? Date.parse(a.next_setting) : NaN;
    const tNow = now.getTime();
    // next_rising / next_setting can be either upcoming today or tomorrow; match
    // against same-day occurrences by comparing modulo 24h.
    function within(target: number): boolean {
      if (!Number.isFinite(target)) return false;
      let delta = target - tNow;
      // Normalize to nearest occurrence (could be up to a full day in the future).
      const day = 24 * 60 * 60 * 1000;
      while (delta > day / 2) delta -= day;
      while (delta < -day / 2) delta += day;
      return Math.abs(delta) <= WINDOW_MS;
    }
    if (within(rising)) return 'sunrise';
    if (within(setting)) return 'evening';
    if (sun.state === 'above_horizon') return 'day';
    if (sun.state === 'below_horizon') return 'night';
  }
  // Clock fallback: 5–8 sunrise, 8–18 day, 18–21 evening, else night.
  const h = now.getHours();
  if (h >= 5 && h < 8) return 'sunrise';
  if (h >= 8 && h < 18) return 'day';
  if (h >= 18 && h < 21) return 'evening';
  return 'night';
}

export function resolveMood(config: MoodConfig | null | undefined, ctx: ResolveContext): ResolvedMood | null {
  if (!config || !config.enabled) return null;
  const opacity = clampOpacity(config.opacity);

  if (config.strategy === 'manual') {
    if (!config.moodId) return null;
    return buildResolved(config.moodId, opacity);
  }

  if (config.strategy === 'time') {
    const sun = ctx.readEntity('sun.sun');
    const bucket = timeOfDay(ctx.now, sun);
    const moodId = TIME_TO_MOOD[bucket];
    return buildResolved(moodId, opacity);
  }

  if (config.strategy === 'weather') {
    if (!config.weatherEntity) return null;
    const ent = ctx.readEntity(config.weatherEntity);
    if (!ent) return null;
    const condition = (ent.state || '').toLowerCase();
    const moodId = WEATHER_TO_MOOD[condition] ?? 'clouds';
    return buildResolved(moodId, opacity);
  }

  return null;
}
