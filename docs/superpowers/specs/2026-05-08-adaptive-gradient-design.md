# Adaptive gradient — design

## Goal

Let a scene's animated gradient pull its colors from whatever the scene's widgets are currently rendering — most obviously a media_player's album art, but extensible to any widget kind including canvas. Make the live palette readable from the server side too, so an agent (in-product or via MCP) can answer "what colors are showing on the kitchen wall right now?"

User-facing surface: a new checkbox **"Adapt colors to widget content"** in the scene editor's gradient block. When off, behavior is unchanged. When on, the server overrides `gradient.colors` with the display's reported palette before pushing — exactly the same mechanism `sun_adaptive` uses today.

## Guiding simplifications

- **One color-injection mechanism.** Adaptive colors and `sun_adaptive` both end up overriding `gradient.colors` in the assembler. The display renders `gradient.colors` as it always has — no new branch in `Background.svelte` or `Gradient.svelte`.
- **One reporting helper for every widget kind.** Whether the colors come from `<MediaPlayer>` (sampling its own album-art `<img>`) or a canvas iframe (calling `cosmos.reportColors([...])`), both call the same flat helper: `reportWidgetPalette(widgetId, colors)`. That helper does one thing — `POST /api/displays/<name>/palette { widgetId, colors }`. No client-side store, no client-side reducer, no client-side debouncer.
- **All bookkeeping on the server.** The server holds `Map<displayId, Map<widgetId, string[]>>`, runs the reducer (union → dedupe → top 3), and emits a scene re-push when the resolved palette actually changes. The display's job collapses to "extract from an image, send what I see."
- **Always report; opt-in to apply.** The display reports any palette it computes regardless of the scene's `adaptive_colors` flag. The flag only controls whether the assembler swaps the colors. The agent can therefore always read "what's showing" via the GET, even on scenes that haven't opted into the visual effect.

## Why per-widget sampling, not a DOM snapshot

Color-rich sources on screen are already image elements: album art is an `<img>`, camera snapshots are an `<img>`. Sampling those directly is a 10-line `drawImage` + `getImageData`. A whole-DOM snapshot via `html2canvas` would add ~200 KB of dependency, run 50–300 ms on a Pi, *and* still need a bridge fallback for canvas iframes (sandboxed cross-origin, can't be rasterized into a readable canvas without weakening the sandbox we just hardened). Per-widget direct sampling is genuinely less code and runs faster.

## Architecture

```
[Display]                                                   [Server]

MediaPlayer.svelte ─sample <img>─┐
                                 │
Canvas.svelte ◄─postMessage── canvas iframe (cosmos.reportColors)
                                 │
                                 ▼
              reportWidgetPalette(widgetId, colors)
              POST /api/displays/<name>/palette
              body { widgetId, colors }                  ─────►  displayPalette store
                                                                  Map<displayId, Map<widgetId, string[]>>
                                                                                │
                                                                                ▼
                                                                  reducer (union → dedupe → top 3)
                                                                                │
                                                                                ▼
                                                                  resolved changed vs. last? ─yes─► onPaletteChanged(displayId)
                                                                                                            │
                                                                                                            ▼
                                                                                                   ws.pushSceneTo(displayId)
                                                                                                            │
                                                                                                            ▼
                                                                  assembler reads palette,
                                                                  overrides gradient.colors when
                                                                  background.adaptive_colors === true
                                                                                │
                                                                                ▼
                                                                  existing scene-push pipeline,
                                                                  existing Gradient.svelte renders
                                                                                │
                                                                                ▼
                                                                  GET /api/displays/<name>/palette
                                                                  agent tool get_display_palette
                                                                  (also surfaced via MCP)
```

## Components

### Display side — minimal

#### `display/src/lib/scene/extractPalette.ts` (new, pure)

`extractFromImage(img: HTMLImageElement): string[]` — paints to a 64×64 offscreen canvas, samples every Nth pixel, bins into a 5×5×5 RGB histogram, drops near-greyscale buckets, returns up to 5 `#rrggbb` strings sorted by bucket population. ~60 lines, no deps.

Plus `extractFromUrl(url: string): Promise<string[]>` — loads `<img crossorigin="anonymous">` and calls `extractFromImage`. Used by `MediaPlayer.svelte`.

#### `display/src/lib/scene/reportPalette.ts` (new, ~25 lines)

```ts
let displayName: string | null = null;
export function setDisplayName(name: string | null): void { displayName = name; }

export function reportWidgetPalette(widgetId: string, colors: string[]): void {
  if (!displayName) return;
  void fetch(`/api/displays/${encodeURIComponent(displayName)}/palette`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ widgetId, colors }),
  }).catch(() => {});
}
```

That's the entire client-side mechanism. No store, no reducer, no debounce. Empty `colors` clears that widget's slot. Failures are swallowed (the gradient still works; the agent just sees stale data).

#### `display/src/routes/+page.svelte`

After display registration, call `setDisplayName(name)` once. One line.

#### Per-widget contributors

- **`MediaPlayer.svelte`** — reactive on `data.album_art_url`. When it changes and is non-empty, `extractFromUrl(url).then((c) => reportWidgetPalette(widget.id, c))`. When it goes empty or the widget unmounts, `reportWidgetPalette(widget.id, [])` to clear. Cache the last extracted URL so a re-render with the same art doesn't re-fetch/re-extract.
- **`Canvas.svelte` + `canvasBridge.ts`** — bridge gets `cosmos.reportColors(colors: string[])`, posts `{ type: 'cosmos:report-colors', colors }` to the parent. The Canvas component's existing message handler validates (array of 1–5 hex strings) and calls `reportWidgetPalette(widget.id, colors)`. Empty array clears. Calls `reportWidgetPalette(widget.id, [])` on iframe unmount.

Both end with one call to `reportWidgetPalette`. From the helper's perspective they're identical — that's the shared mechanism.

Other built-in widgets (clock, weather, entity_tile, calendar, statistics, text, camera) emit no signal in v1. The mechanism is ready for them.

### Server side — where the bookkeeping lives

#### `server/src/store/displayPalette.ts` (new)

In-memory, keyed by display id, holding the per-widget contributions plus the last-resolved palette so the change-detector can compare.

```ts
type Entry = { contributions: Map<string, string[]>; resolved: string[]; updatedAt: string };
type DisplayPaletteStore = {
  set(displayId, widgetId, colors): { resolvedChanged: boolean };
  getResolved(displayId): { colors: string[]; updatedAt: string | null };
  clearDisplay(displayId): void;     // on disconnect
  pruneWidgets(displayId, keepIds): void;  // on scene change
};
```

`set` runs the reducer and reports whether the resolved set changed (used to decide whether to re-push the scene).

#### `server/src/scenes/palette.ts` (new, pure)

`reducePalette(contributions: Map<string, string[]>, fallback: string[], targetCount = 3): string[]` — union all contributions, dedupe by HSL distance ≥ 0.15, sort by occurrence frequency, keep the top `targetCount`. If fewer distinct than `targetCount`, pad from `fallback`. If no contributions, return `[]` (the assembler treats empty as "don't override").

Pure function, easy to unit-test.

#### REST endpoints (in `server/src/api/http.ts`)

- `POST /api/displays/:name/palette` — body `{ widgetId: string, colors: string[] }`. Validates 0–5 colors each matching `/^#[0-9a-f]{6}$/i`, resolves name → displayId via `displays.getByName`, calls `displayPalette.set`. If `resolvedChanged`, calls `onPaletteChanged?.(displayId)` so the WS hub re-pushes the scene to this display. Returns 204 on success, 400 on bad shape, 404 on unknown display.
- `GET /api/displays/:name/palette` — returns `{ colors: string[], updatedAt: string | null }` (empty colors and null timestamp when nothing reported).

#### Assembler change (single-mechanism color override)

`server/src/scenes/assembler.ts` already does `sun_adaptive` color resolution. Add a parallel pass for adaptive_colors:

```ts
let background = scene.background;
if (background.type === 'gradient' && background.sun_adaptive) {
  background = { ...background, colors: resolveSunGradient(now, readEntitySync('sun.sun')) };
}
if (background.type === 'gradient' && background.adaptive_colors && adaptivePalette && adaptivePalette.length > 0) {
  background = { ...background, colors: adaptivePalette };
}
```

`adaptivePalette` is a new optional argument to `buildSceneState` / `AssemblePushArgs`, threaded from `buildPayload(displayId)` in `ws.ts`, which reads it from `displayPalette.getResolved(displayId).colors`. Same wiring style as `canvasFetchPolicy`.

Order matters: `sun_adaptive` runs first (sets time-of-day fallback), `adaptive_colors` overrides it when something is reporting. With both flags on they compose — when nothing's reporting, sun-adaptive paints; when a song plays, the album art steals the palette; when it pauses again, sun-adaptive reasserts on the next push.

#### Reactivity

The WS hub already re-pushes the scene to a display on `onSettingsChanged`. We add a sibling `onPaletteChanged(displayId)` that re-pushes only that display's scene. Triggered by `POST /palette` when `set` reports `resolvedChanged: true`. The display receives the new SceneState with overridden colors, the existing `Gradient.svelte` renders them, CSS animates the change via the existing keyframes.

No extraction loop: the display extracts from album art (or canvas-reported colors), not from `gradient.colors`. New scene-push doesn't change the album art URL, so no re-extract, no re-POST.

#### Cleanup

- **Display disconnect.** WS hub already fires display-removed callbacks. Wire one to `displayPalette.clearDisplay(displayId)`.
- **Widget removed from scene.** When the assembler runs for a display, after building the widget list it calls `displayPalette.pruneWidgets(displayId, currentWidgetIds)` so a removed widget's stale colors don't keep contributing forever. Cheap (set-difference on a small map).

#### Agent tool

`get_display_palette({ displayName })` in `server/src/agent/tools.ts` — wraps the GET via `app.inject`. The MCP server picks it up automatically through the existing tool registration.

### Editor

In `display/src/routes/admin/scenes/[id]/+page.svelte` gradient block, a new checkbox bound to `background.adaptive_colors`. Hint text:

> "Pull live colors from album art, canvases, etc. Falls back to the colors above when nothing is reporting. Stacks with sun-adaptive."

### Storage

`Scene.background` (gradient variant) gains `adaptive_colors?: boolean`. Persisted as part of the existing JSON column → **no migration**. Server treats absent as false.

## Failure modes

- **Image fails to load (CORS, 404):** `extractFromUrl` rejects; MediaPlayer reports an empty array to clear its contribution.
- **Server unreachable for `POST /palette`:** swallow the error. Gradient lags by one push until the next successful POST.
- **Canvas reports junk:** non-array, non-hex, >5 entries → drop the message at `Canvas.svelte`. Bridge contract documents the shape.
- **Two displays running the same scene with different media:** each has its own entry in the store; the assembler is called per-display, so each display gets its own override. They naturally diverge.
- **Stale widget contributions:** pruned by `displayPalette.pruneWidgets` on every assemble pass.

## Testing

- `extractPalette.test.ts` (display) — synthetic 64×64 RGBA buffer with known dominant red + secondary blue → returns those colors. Greyscale-only image → returns empty. (Vitest with a node-canvas polyfill, or deferred to manual smoke if jsdom is too thin.)
- `palette.test.ts` (server, pure) — reducer: union + dedupe + top-N for several mixes; padding from fallback when fewer distinct than target; empty input → empty output.
- `displayPalette.test.ts` (server) — `set` + `getResolved` round-trip; `set` reports `resolvedChanged: false` on a no-op write; `clearDisplay` empties; `pruneWidgets` keeps only the listed ids.
- `palette.api.test.ts` (server) — `POST` rejects non-hex / >5 colors / unknown display; `POST` followed by `GET` returns the resolved set; `POST` triggers `onPaletteChanged` only when the resolved set changed.
- `assembler.test.ts` (extend) — when `adaptive_colors === true` and a palette is supplied, gradient.colors is overridden; when false, untouched; when both `sun_adaptive` and `adaptive_colors` are on, adaptive wins over sun.
- `agent-tools.test.ts` (extend) — `get_display_palette` returns the stored value; returns empty when nothing reported.

No e2e — visual feature, manual smoke (play a song, watch the gradient).

## Documentation

- `docs/canvas-widget-agent.md` — add `cosmos.reportColors(colors: string[])` to the JS API table + a short example.
- `docs/canvas-widget.md` — same, plus a one-liner: "if your canvas has dominant colors worth feeding back to the scene gradient, report them."
- No new top-level doc; this is a small extension of the gradient feature.

## Out of scope (deferred)

- Color samplers for clock / weather / entity_tile / camera. Wiring is mechanical; defer.
- Per-source priority (auto-mix only).
- Smooth crossfade beyond what the existing scene-push CSS transition gives us.
- Persisting the live palette across server restarts (ephemeral by design).
