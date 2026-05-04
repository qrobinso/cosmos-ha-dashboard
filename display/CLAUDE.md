# Cosmos Display

SvelteKit + Svelte 4 + adapter-static. Served by the server from the same origin in production; in dev, Vite proxies `/api` and `/ws` to `http://localhost:8099`.

## Layout

- `src/routes/+page.svelte` — single page. Three states: onboarding form (no display name), `<SceneCanvas>` (scene received), greeting fallback (display registered but no scene assigned). Connects to the server WS, persists display name in `localStorage`.
- `src/routes/+layout.svelte` — imports `$lib/fonts.css` so bundled fonts are loaded once.
- `src/lib/types.ts` — mirror of the server's `SceneState`/`WidgetState` types. Keep in sync.
- `src/lib/storage.ts` — SSR-safe localStorage helpers for the display name.
- `src/lib/ws.ts` — `connect(displayName, onMessage)` opens a WebSocket, sends hello on open, parses messages, exposes typed `ServerMessage` to callers. Handles `error`/`close` and reports both as `{type:'error'}`.
- `src/lib/scene/SceneCanvas.svelte` — composes `<Background>` + a CSS Grid widget layer. Reads `scene.layout.{cols,rows}` for grid dimensions, `scene.safeArea` for padding, `scene.typography` for font family + scale (CSS variable `--cosmos-font-scale`).
- `src/lib/scene/WidgetSlot.svelte` — positions a widget into its grid cell.
- `src/lib/widgets/` — one file per widget kind. Render functions only; data arrives via `widget.data` from the server.
  - `Clock.svelte` — renders local time + date; updates every 30s.
  - `Weather.svelte` — renders `widget.data` as `WeatherData`.
  - `EntityTile.svelte` — type-aware: picks a renderer based on entity domain (`light`, `switch`, `binary_sensor`, `sensor`, `climate`, `lock`, `cover`, fallback).
- `src/lib/backgrounds/` — `Background.svelte` dispatches to `Solid.svelte` or `Gradient.svelte`. Gradient runs an infinite CSS animation (continuously moving) and respects `prefers-reduced-motion`.
- `src/lib/fonts.css` — `@fontsource/*` imports. Defines `--cosmos-font-Inter` etc. CSS variables.
- `src/lib/transitions/controller.ts` — `TransitionController` state machine. Drives the Out → Bridge → In phases on incoming scene changes. Honors `prefers-reduced-motion`.
- `src/lib/transitions/keyframes.css` — `@keyframes` blocks named to match server descriptors (`cosmos-out-fade`, `cosmos-in-scale-fade`, etc.). Add a new pair when adding a new transition.
- `src/lib/scene/TransitionStage.svelte` — wraps `SceneCanvas`. Mounts both outgoing and incoming canvases during a transition; applies CSS classes that drive the keyframe animations.
- `src/lib/overlay/MessageOverlay.svelte` — toast/banner overlay layered above the scene canvas. Auto-dismisses on `timeout_ms`; tappable to dismiss early. Reduced-motion safe.
- `src/lib/admin/` — admin-only utilities (typed API helpers, generic `Field.svelte` form-field).
- `src/routes/admin/` — admin editor pages: home (`+page.svelte`), scenes list (`scenes/+page.svelte`), scene editor (`scenes/[id]/+page.svelte`), displays manager (`displays/+page.svelte`), global settings (`settings/+page.svelte`). Utilitarian forms; no animation; system fonts. Iframe-friendly for HA sidebar mounting (Plan 6).

## Conventions

- All animation is CSS-driven (`@keyframes`, `transition`, `background-position`). No JS in the render loop.
- Widgets read `widget.data` directly. They do not fetch or compute data.
- No display-side test suite yet — the end-to-end Playwright smoke in plan verification is the gate.
- Inline styles are intentional during early plans; design language solidifies in later plans.

## Adding a widget

1. Add the kind to `WidgetKind` in this file's `types.ts` and the server's `scenes.ts`.
2. Create `src/lib/widgets/Foo.svelte` reading `widget` (and `widget.data` if the server provides any).
3. Wire the dispatch in `SceneCanvas.svelte`: import `Foo`, add `{:else if w.kind === 'foo'}<Foo widget={w} />`.
4. On the server: extend `assembler.ts` `dataFor()` if the widget needs server-resolved data.

## Build

```bash
npm --workspace display run build            # writes display/build/
npm --workspace display run dev              # http://localhost:5173 with HMR
```
