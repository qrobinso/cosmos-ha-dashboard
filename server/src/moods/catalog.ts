import type { MoodCatalogEntry } from './types.js';

/**
 * The bundled mood library. Each entry maps to a video file at
 * `display/static/moods/<file>` which is served at `/moods/<file>`.
 *
 * Videos are mp4 with a black background and bright content; the display
 * composites them with `mix-blend-mode: screen` so black becomes transparent.
 *
 * Files dropped into the moods folder that aren't listed here still appear
 * in the manual dropdown (see `scan.ts`) — these entries just give them
 * friendlier labels + tags for time/weather auto-mapping.
 */
export const MOOD_CATALOG: MoodCatalogEntry[] = [
  { id: 'clouds2',     label: 'Soft clouds',     file: 'clouds2.mp4',     tags: ['day', 'sunny', 'cloudy', 'partlycloudy'] },
  { id: 'rain',        label: 'Rain',            file: 'rain.mp4',        tags: ['rainy', 'pouring'] },
  { id: 'snow',        label: 'Falling snow',    file: 'snow.mp4',        tags: ['snowy'] },
  { id: 'stars',       label: 'Starfield',       file: 'stars.mp4',       tags: ['night', 'clear-night'] },
  { id: 'neon-stars',  label: 'Neon stars',      file: 'neon-stars.mp4',  tags: ['night'] },
  { id: 'sunrise',     label: 'Sunrise glow',    file: 'sunrise.mp4',     tags: ['sunrise', 'morning'] },
  { id: 'embers',      label: 'Glowing embers',  file: 'embers.mp4',      tags: ['evening', 'fireplace'] },
  { id: 'aurora',      label: 'Aurora',          file: 'aurora.mp4',      tags: ['night'] },
  { id: 'fireflies',   label: 'Fireflies',       file: 'fireflies.mp4',   tags: ['evening', 'night'] },
  { id: 'particles',   label: 'Drifting particles', file: 'particles.mp4', tags: ['ambient'] },
  { id: 'orb1',        label: 'Orb',             file: 'orb1.mp4',        tags: ['ambient'] },
  { id: 'flames',      label: 'Flames',          file: 'flames.mp4',      tags: ['evening', 'fireplace'] },
  { id: 'tree',        label: 'Tree',            file: 'tree.mp4',        tags: ['ambient'] },
  { id: 'lightning',       label: 'Lightning',       file: 'lightning.mp4',       tags: ['lightning', 'lightning-rainy', 'storm'] },
  { id: 'water-droplets',  label: 'Water droplets',  file: 'water-droplets.mp4',  tags: ['rainy', 'pouring'] },
];

export function getMoodById(id: string): MoodCatalogEntry | null {
  return MOOD_CATALOG.find((m) => m.id === id) ?? null;
}

export type TimeOfDay = 'sunrise' | 'day' | 'evening' | 'night';

/** Default mood id played for each time-of-day bucket. */
export const TIME_TO_MOOD: Record<TimeOfDay, string> = {
  sunrise: 'sunrise',
  day:     'clouds2',
  evening: 'embers',
  night:   'stars',
};

/**
 * Normalized HA weather condition → mood id. Maps each HA `weather.<entity>`
 * state value to the file we play. Unknown conditions fall back to `clouds2`.
 *
 * Update this table if you add new weather-themed clips to the moods folder
 * (e.g. add a `fog.mp4` and route `fog` to it instead of `clouds2`).
 */
export const WEATHER_TO_MOOD: Record<string, string> = {
  // Clear / cloudy days — drifting clouds clip.
  sunny:             'clouds2',
  clear:             'clouds2',
  partlycloudy:      'clouds2',
  cloudy:            'clouds2',
  fog:               'clouds2',
  windy:             'clouds2',
  'windy-variant':   'clouds2',
  exceptional:       'clouds2',

  // Wet weather. The mapping leans on the *intensity* + *character* of the
  // HA condition: light rain reads as gentle drops, pouring as heavier rain,
  // lightning and lightning-rainy get the proper storm clip, hail keeps the
  // heavy-rain clip as the closest match (no dedicated hail loop yet).
  rainy:             'water-droplets',
  pouring:           'rain',
  lightning:         'lightning',
  'lightning-rainy': 'lightning',
  hail:              'rain',

  // Snowy weather → snow.
  snowy:             'snow',
  'snowy-rainy':     'snow',

  // Clear night → stars.
  'clear-night':     'stars',
};
