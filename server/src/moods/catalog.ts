import type { MoodCatalogEntry } from './types.js';

/**
 * The bundled mood library. Each entry maps to a video file at
 * `display/static/moods/<file>` which is served at `/moods/<file>`.
 *
 * Videos are mp4 with a black background and bright content; the display
 * composites them with `mix-blend-mode: screen` so black becomes transparent.
 */
export const MOOD_CATALOG: MoodCatalogEntry[] = [
  { id: 'clouds',  label: 'Drifting clouds', file: 'clouds.mp4',  tags: ['day', 'sunny', 'cloudy'] },
  { id: 'rain',    label: 'Rain',            file: 'rain.mp4',    tags: ['rainy'] },
  { id: 'snow',    label: 'Falling snow',    file: 'snow.mp4',    tags: ['snowy'] },
  { id: 'stars',   label: 'Starfield',       file: 'stars.mp4',   tags: ['night', 'clear-night'] },
  { id: 'sunrise', label: 'Sunrise glow',    file: 'sunrise.mp4', tags: ['sunrise'] },
  { id: 'embers',  label: 'Glowing embers',  file: 'embers.mp4',  tags: ['evening'] },
];

export function getMoodById(id: string): MoodCatalogEntry | null {
  return MOOD_CATALOG.find((m) => m.id === id) ?? null;
}

export type TimeOfDay = 'sunrise' | 'day' | 'evening' | 'night';

/** Default mood id played for each time-of-day bucket. */
export const TIME_TO_MOOD: Record<TimeOfDay, string> = {
  sunrise: 'sunrise',
  day:     'clouds',
  evening: 'embers',
  night:   'stars',
};

/** Normalized HA weather condition → mood id. Unknown conditions fall back to 'clouds'. */
export const WEATHER_TO_MOOD: Record<string, string> = {
  sunny:          'clouds',
  clear:          'clouds',
  partlycloudy:   'clouds',
  cloudy:         'clouds',
  fog:            'clouds',
  windy:          'clouds',
  'windy-variant':'clouds',
  rainy:          'rain',
  pouring:        'rain',
  lightning:      'rain',
  'lightning-rainy': 'rain',
  hail:           'rain',
  snowy:          'snow',
  'snowy-rainy':  'snow',
  'clear-night':  'stars',
  exceptional:    'clouds',
};
