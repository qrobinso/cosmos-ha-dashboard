/** Tiny network helper for the adaptive-gradient feature. Each widget that
 *  contributes colors (MediaPlayer for album art, Canvas forwarding iframe
 *  reports) calls `reportWidgetPalette(widget.id, colors)`. We POST it
 *  fire-and-forget; the server holds the per-widget map and runs the
 *  reducer. Empty `colors` clears that widget's contribution.
 *
 *  Failures are swallowed: the gradient on screen is unaffected (it just
 *  lags by one push) and the agent sees stale data until the next
 *  successful POST. */

let displayName: string | null = null;

export function setDisplayName(name: string | null): void {
  displayName = name;
}

export function reportWidgetPalette(widgetId: string, colors: string[]): void {
  if (!displayName) return;
  void fetch(`/api/displays/${encodeURIComponent(displayName)}/palette`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ widgetId, colors }),
  }).catch(() => {});
}
