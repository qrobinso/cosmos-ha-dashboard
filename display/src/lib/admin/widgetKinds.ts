// Single source of truth for widget-kind metadata: label, palette grouping,
// icon, accent hue, blurb, default size, the initial config for a freshly
// added or re-typed instance, and the user-facing instance label.
//
// This replaces the formerly scattered WIDGET_KINDS / WIDGET_KIND_LABELS
// constants, the giant setWidgetKind() switch (now `defaultConfig` per kind),
// the `centeredPosition` size defaults (`defaultSize`), and the
// `firstEntityOfDomain` lookups (now done inside `defaultConfig`).
//
// FUTURE (v2): a `previewComponent?: ComponentType` field so canvas tiles can
// render a scaled live preview of the real widget with mock data instead of
// the iconic chip. Out of scope for now — see the widget-editor revamp spec.

import type { EntityState, WidgetKind } from '$lib/types';

export type WidgetCategory = 'time' | 'ha' | 'canvas';

export type WidgetKindMeta = {
  kind: WidgetKind;
  label: string;
  category: WidgetCategory;
  /** Inline-SVG inner markup; see widgetIcons.ts. */
  icon: string;
  /** Theme-friendly hue for the tile icon chip + palette icon. Distinct per
   *  kind; reads well on the dark admin surfaces. Never the global accent. */
  accent: string;
  /** One-liner for the palette tooltip. */
  blurb: string;
  defaultSize: { w: number; h: number };
  /** Build the initial config for a freshly-added or re-typed widget.
   *  `entities` is the cached HA entity list so domain-bearing kinds can pick
   *  a sensible first match. */
  defaultConfig: (entities: EntityState[]) => Record<string, unknown>;
  /** User-facing name for a widget instance (inspector header / canvas tile).
   *  Most kinds: `config.name` if set, else the label. Entity kinds: the
   *  bound entity_id when no explicit name. */
  instanceLabel: (config: Record<string, unknown>) => string;
};

import { widgetIcons } from './widgetIcons';
import { CALENDAR_SOURCE_PALETTE } from './widgets/calendarPalette';

function firstEntityOfDomain(entities: EntityState[], domain: string): string {
  return entities.find((e) => e.entity_id.startsWith(`${domain}.`))?.entity_id ?? '';
}

function str(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** `config.name` (a soft convention shared by every kind, not just canvas) →
 *  else the kind label. The bound entity_id, when present, surfaces separately
 *  as the canvas tile's meta line, so we don't fold it in here. */
function labelFrom(config: Record<string, unknown>, fallback: string): string {
  return str(config, 'name') || fallback;
}

export const widgetKinds: Record<WidgetKind, WidgetKindMeta> = {
  clock: {
    kind: 'clock',
    label: 'Clock',
    category: 'time',
    icon: widgetIcons.clock,
    accent: '#8fb6ef', // moonlight blue
    blurb: 'Local time and date, ticking.',
    defaultSize: { w: 4, h: 2 },
    defaultConfig: () => ({ format: '24h' }),
    instanceLabel: (c) => labelFrom(c, 'Clock'),
  },
  text: {
    kind: 'text',
    label: 'Text',
    category: 'time',
    icon: widgetIcons.text,
    accent: '#cdd1de', // soft chalk
    blurb: 'A free-text note that scales to fit.',
    defaultSize: { w: 4, h: 2 },
    defaultConfig: () => ({ content: 'Hello!', align: 'center', weight: '300' }),
    instanceLabel: (c) => {
      const name = str(c, 'name');
      if (name) return name;
      const content = str(c, 'content');
      if (content) return content.length > 24 ? `${content.slice(0, 24)}…` : content;
      return 'Text';
    },
  },
  weather: {
    kind: 'weather',
    label: 'Weather',
    category: 'ha',
    icon: widgetIcons.weather,
    accent: '#5fd3a3', // aurora teal
    blurb: 'Current conditions plus a forecast strip.',
    defaultSize: { w: 4, h: 4 },
    defaultConfig: (entities) => ({
      entity_id: firstEntityOfDomain(entities, 'weather') || 'weather.home',
      forecast_type: 'daily',
      forecast_slots: 5,
      show_current: true,
      show_forecast: true,
      show_name: true,
      secondary_info_attribute: '',
      temperature_unit: 'auto',
      time_format: '24h',
      name: '',
    }),
    instanceLabel: (c) => labelFrom(c, 'Weather'),
  },
  entity_tile: {
    kind: 'entity_tile',
    label: 'Entity tile',
    category: 'ha',
    icon: widgetIcons.entity_tile,
    accent: '#ffd17a', // warm gold — entity is the everyday widget
    blurb: 'One entity, rendered for its domain.',
    defaultSize: { w: 4, h: 2 },
    defaultConfig: (entities) => ({ entity_id: entities[0]?.entity_id ?? '' }),
    instanceLabel: (c) => labelFrom(c, 'Entity tile'),
  },
  calendar: {
    kind: 'calendar',
    label: 'Calendar agenda',
    category: 'ha',
    icon: widgetIcons.calendar,
    accent: '#f06b9c', // calendar pink
    blurb: 'Upcoming events from a calendar entity.',
    defaultSize: { w: 4, h: 4 },
    defaultConfig: (entities) => ({
      view: 'agenda',
      sources: entities
        .filter((e) => e.entity_id.startsWith('calendar.'))
        .slice(0, 1)
        .map((e, i) => ({
          id: e.entity_id,
          entity_id: e.entity_id,
          label: e.entity_id.replace(/^calendar\./, '').replace(/_/g, ' '),
          color: CALENDAR_SOURCE_PALETTE[i % CALENDAR_SOURCE_PALETTE.length],
        })),
      days_ahead: 7,
      max_events: 8,
      show_header: true,
      show_all_day: true,
      show_location: true,
      show_description: false,
      group_by_day: true,
      hide_past: true,
      time_format: '24h',
    }),
    instanceLabel: (c) => labelFrom(c, 'Calendar agenda'),
  },
  media_player: {
    kind: 'media_player',
    label: 'Media player',
    category: 'ha',
    icon: widgetIcons.media_player,
    accent: '#b08cff', // playback violet
    blurb: 'Now-playing art, info and transport.',
    defaultSize: { w: 4, h: 3 },
    defaultConfig: (entities) => ({
      entity_id: firstEntityOfDomain(entities, 'media_player') || 'media_player.living_room',
      show_album_art: true,
      show_title: true,
      show_artist: true,
      show_album: false,
      show_progress: true,
      show_controls: true,
      show_volume: false,
      show_source: false,
      blur_background: true,
      compact: false,
    }),
    instanceLabel: (c) => labelFrom(c, 'Media player'),
  },
  statistics: {
    kind: 'statistics',
    label: 'Statistics / history',
    category: 'ha',
    icon: widgetIcons.statistics,
    accent: '#f3a26a', // chart amber
    blurb: 'A sparkline of a numeric entity over time.',
    defaultSize: { w: 4, h: 3 },
    defaultConfig: (entities) => ({
      entity_id: firstEntityOfDomain(entities, 'sensor') || 'sensor.outside_temp',
      hours_back: 24,
      show_current: true,
      show_min_max: true,
      show_unit: true,
      show_axis: false,
      show_area_fill: true,
      smoothing: true,
      chart_type: 'line',
      title: '',
      color: '',
    }),
    instanceLabel: (c) => str(c, 'name') || str(c, 'title') || 'Statistics',
  },
  camera: {
    kind: 'camera',
    label: 'Camera',
    category: 'ha',
    icon: widgetIcons.camera,
    accent: '#7fb2f0', // lens blue
    blurb: 'A camera snapshot or live WebRTC/HLS/MJPEG stream.',
    defaultSize: { w: 4, h: 3 },
    defaultConfig: (entities) => ({
      entity_id: firstEntityOfDomain(entities, 'camera') || 'camera.front_door',
      view: 'auto',
      protocol: 'auto',
      refresh_interval_s: 10,
      fit: 'cover',
      aspect_ratio: '',
      show_name: false,
      show_state: false,
      name: '',
    }),
    instanceLabel: (c) => labelFrom(c, 'Camera'),
  },
  canvas: {
    kind: 'canvas',
    label: 'Canvas (HTML/JS)',
    category: 'canvas',
    icon: widgetIcons.canvas,
    accent: '#a8a6ff', // celestial violet — the bespoke kind
    blurb: 'A sandboxed iframe of your own HTML, CSS and JS.',
    defaultSize: { w: 4, h: 3 },
    defaultConfig: () => ({
      content:
        '<div style="display:grid;place-items:center;width:100%;height:100%;font-family:system-ui;color:#f5f5f5">\n  <div>Hello, canvas!</div>\n</div>',
    }),
    instanceLabel: (c) => labelFrom(c, 'Canvas'),
  },
};

/** All kinds in palette order (Time & info, then Home Assistant, then Canvas). */
export const widgetKindOrder: WidgetKind[] = [
  'clock',
  'text',
  'weather',
  'entity_tile',
  'calendar',
  'media_player',
  'statistics',
  'camera',
  'canvas',
];

export const categoryLabels: Record<WidgetCategory, string> = {
  time: 'Time & info',
  ha: 'Home Assistant',
  canvas: 'Canvas',
};

/** Grouped {category, label, kinds[]} for rendering the palette. */
export function paletteGroups(): { category: WidgetCategory; label: string; kinds: WidgetKindMeta[] }[] {
  const cats: WidgetCategory[] = ['time', 'ha', 'canvas'];
  return cats.map((category) => ({
    category,
    label: categoryLabels[category],
    kinds: widgetKindOrder.filter((k) => widgetKinds[k].category === category).map((k) => widgetKinds[k]),
  }));
}

/** Build a default-sized, centered position for a new widget of `kind`,
 *  clamped to the layout. */
export function centeredPositionFor(
  kind: WidgetKind,
  layout: { cols: number; rows: number },
): { col: number; row: number; w: number; h: number } {
  const { w, h } = widgetKinds[kind].defaultSize;
  const safeW = Math.min(w, layout.cols);
  const safeH = Math.min(h, layout.rows);
  return {
    col: Math.max(1, Math.floor((layout.cols - safeW) / 2) + 1),
    row: Math.max(1, Math.floor((layout.rows - safeH) / 2) + 1),
    w: safeW,
    h: safeH,
  };
}

/** Place a new widget of `kind` so its top-left sits at (col,row), clamped so
 *  the default-size widget fits inside the layout. */
export function positionAt(
  kind: WidgetKind,
  layout: { cols: number; rows: number },
  col: number,
  row: number,
): { col: number; row: number; w: number; h: number } {
  const { w, h } = widgetKinds[kind].defaultSize;
  const safeW = Math.min(w, layout.cols);
  const safeH = Math.min(h, layout.rows);
  return {
    col: Math.max(1, Math.min(col, layout.cols - safeW + 1)),
    row: Math.max(1, Math.min(row, layout.rows - safeH + 1)),
    w: safeW,
    h: safeH,
  };
}
