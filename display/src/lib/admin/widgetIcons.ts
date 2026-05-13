// Inline-SVG path data for each widget kind, drawn in a consistent 24×24
// stroke style (fill:none; stroke:currentColor; stroke-width:1.7;
// round caps/joins) matching the kiosk's existing SVGs. These render at
// roughly 18–24px in palette entries, canvas tiles and the inspector header,
// so they're kept deliberately tiny — a couple of strokes each.

import type { WidgetKind } from '$lib/types';

/** SVG inner markup (paths/circles) for each kind; wrap in
 *  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
 *  stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">…</svg>. */
export const widgetIcons: Record<WidgetKind, string> = {
  clock:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  weather:
    '<path d="M7 18a4 4 0 0 1 .4-8 5.5 5.5 0 0 1 10.3 1.6A3.5 3.5 0 0 1 17 18Z"/><path d="M16 6.5 17 5M19.5 9h1.5M18 4l.8-1.2"/>',
  entity_tile:
    '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/>',
  calendar:
    '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4M8 13h2M14 13h2M8 16.5h2"/>',
  media_player:
    '<circle cx="12" cy="12" r="8.5"/><path d="M10.5 9.5v5l4-2.5z"/>',
  statistics:
    '<path d="M4 19h16M5 19V6"/><path d="M5 15l4-4 3 3 6-7"/><path d="M18 7v4h-4"/>',
  text:
    '<path d="M5 6h14M12 6v13M9.5 19h5"/>',
  camera:
    '<rect x="3" y="7" width="18" height="12" rx="2.5"/><path d="M8.5 7l1.3-2.2h4.4L19.5 7"/><circle cx="12" cy="13" r="3.2"/>',
  canvas:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 8.5h17M7 12.5h6M7 15.5h9M16.5 11.5l1.5 1.5-1.5 1.5"/>',
};

/** Convenience: a complete <svg> string for `{@html}` use. */
export function widgetIconSvg(kind: WidgetKind, size = 24): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true">${widgetIcons[kind]}</svg>`
  );
}
