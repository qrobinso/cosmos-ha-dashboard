import { AERIAL_CATEGORIES, AERIAL_INTERVALS_MIN } from './types.js';

/** Apple asset ids are uppercase UUIDs; the same charset the stream route accepts. */
export const AERIAL_ID_RE = /^[A-Za-z0-9-]{1,40}$/;

/**
 * Shape-check an `AerialMoodConfig` coming in over the API. Returns an error
 * message keyed under `prefix` (e.g. "mood.aerials"), or null when valid.
 */
export function validateAerialMoodConfig(v: unknown, prefix = 'mood.aerials'): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return `${prefix} must be an object`;
  const a = v as Record<string, unknown>;
  if (!Array.isArray(a.ids)) return `${prefix}.ids must be an array of aerial ids`;
  if (a.ids.length > 200) return `${prefix}.ids may hold at most 200 clips`;
  if (a.ids.some((id) => typeof id !== 'string' || !AERIAL_ID_RE.test(id))) {
    return `${prefix}.ids entries must be aerial ids (letters, digits, dashes)`;
  }
  if (a.categories !== undefined) {
    if (!Array.isArray(a.categories)) return `${prefix}.categories must be an array`;
    if (a.categories.some((c) => !(AERIAL_CATEGORIES as readonly unknown[]).includes(c))) {
      return `${prefix}.categories entries must be one of ${AERIAL_CATEGORIES.join(' | ')}`;
    }
  }
  const cats = Array.isArray(a.categories) ? a.categories : [];
  if (a.ids.length === 0 && cats.length === 0) return `${prefix} needs at least one clip or category selected`;
  if (a.shuffle !== undefined && typeof a.shuffle !== 'boolean') return `${prefix}.shuffle must be a boolean`;
  if (a.interval_min !== undefined && !(AERIAL_INTERVALS_MIN as readonly unknown[]).includes(a.interval_min)) {
    return `${prefix}.interval_min must be one of ${AERIAL_INTERVALS_MIN.join(', ')}`;
  }
  return null;
}
