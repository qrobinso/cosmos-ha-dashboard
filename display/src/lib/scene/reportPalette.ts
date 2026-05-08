/** Tiny network helper for the adaptive-gradient feature. Each widget that
 *  contributes colors (MediaPlayer for album art, Canvas forwarding iframe
 *  reports) calls `reportWidgetPalette(widget.id, colors)`. We POST it
 *  fire-and-forget; the server holds the per-widget map and runs the
 *  reducer. Empty `colors` clears that widget's contribution.
 *
 *  The helper gates on a `paletteEnabled` writable store driven by
 *  SceneCanvas: when the active scene's gradient does NOT have
 *  `adaptive_colors`, every call is a no-op so the display avoids
 *  per-song POSTs (and downstream scene re-pushes) for scenes that
 *  don't use the visual effect. Widgets that perform expensive work
 *  to *produce* the palette (MediaPlayer's image decode) should
 *  additionally check `paletteEnabled` themselves before extracting.
 *
 *  Failures are swallowed: the gradient on screen is unaffected (it just
 *  lags by one push) and the agent sees stale data until the next
 *  successful POST. */

import { writable, get } from 'svelte/store';

let displayName: string | null = null;

/** True when the active scene's gradient has `adaptive_colors` enabled.
 *  SceneCanvas writes this reactively. Widgets that need to short-circuit
 *  expensive work before producing colors (e.g. image decode) can read
 *  the value directly via `$paletteEnabled`. */
export const paletteEnabled = writable<boolean>(false);

export function setDisplayName(name: string | null): void {
  displayName = name;
}

export function reportWidgetPalette(widgetId: string, colors: string[]): void {
  if (!displayName) return;
  if (!get(paletteEnabled)) return;
  void fetch(`/api/displays/${encodeURIComponent(displayName)}/palette`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ widgetId, colors }),
  }).catch(() => {});
}
