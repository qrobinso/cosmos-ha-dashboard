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
  - `Canvas.svelte` — sandboxed iframe widget. Mounts with `sandbox="allow-scripts"`, srcdoc = bridge script + resolved content. Forwards entity-state changes from SceneCanvas to the iframe via `postMessage`. Re-mounts only on `widget.config.content` change (`{#key content}`); state-only updates flow as messages.
  - `canvasBridge.ts` — the bridge script as a const string, injected into every canvas iframe.
- `src/lib/backgrounds/` — `Background.svelte` dispatches to `Solid.svelte` or `Gradient.svelte`. Gradient runs an infinite CSS animation (continuously moving) and respects `prefers-reduced-motion`.
- `src/lib/fonts.css` — `@fontsource/*` imports. Defines `--cosmos-font-Inter` etc. CSS variables.
- `src/lib/transitions/controller.ts` — `TransitionController` state machine. Drives the Out → Bridge → In phases on incoming scene changes. Ignores `prefers-reduced-motion` deliberately: this is a passive wall kiosk, not a general-purpose page, and Android Chrome's reduced-motion default would otherwise collapse all transitions to a 120 ms fade.
- `src/lib/transitions/keyframes.css` — `@keyframes` blocks named to match server descriptors (`cosmos-out-fade`, `cosmos-in-scale-fade`, etc.). Add a new pair when adding a new transition.
- `src/lib/scene/TransitionStage.svelte` — wraps `SceneCanvas`. Mounts both outgoing and incoming canvases during a transition; applies CSS classes that drive the keyframe animations.
- `src/lib/overlay/MessageOverlay.svelte` — toast/banner overlay layered above the scene canvas. Auto-dismisses on `timeout_ms`; tappable to dismiss early. Reduced-motion safe.
- `src/lib/scene/MoodLayer.svelte` — looping `<video>` element rendered between the background and widget grid when `scene.resolvedMood` is present. Uses `mix-blend-mode: screen` so any black in the source clip drops out. Pauses on the first frame when `prefers-reduced-motion: reduce`. Mounted with `{#key scene.id}` so it remounts per scene. Source files live in `static/moods/`.
- `src/lib/admin/` — admin-only utilities. Includes `api.ts` (typed fetch helpers), `Field.svelte` (label + slot form-field), `WidgetCanvas.svelte` (drag-and-drop grid editor for the scene editor), and `theme.css` (the admin design system).
- `src/lib/admin/canvasExamples.ts` + `canvas-help.md` — editor's Insert-example dropdown content + How-this-works panel source.
- `src/lib/admin/theme.css` — the admin design system. Scoped to `.cosmos-admin` ancestor class so it never leaks into the kiosk display. Defines a calm, modern dark palette (deep neutral surfaces, single warm accent `--c-accent`), system-friendly typography (Inter for UI, JetBrains Mono for data tags/IDs), 44px touch targets, hairline borders, focus rings, motion via `cubic-bezier(0.2, 0.8, 0.2, 1)`, and a `.reveal` page-load fade-up. Mobile-first; everything stacks on narrow viewports and broadens at `@media (min-width: 600px)` and `720px` breakpoints.
- `src/routes/admin/` — admin editor pages, all wrapped in the `.cosmos-admin` shell:
  - `+layout.svelte` — sticky translucent topbar with a brand mark, **desktop pill nav** ≥720px, and a **hamburger sheet menu** below 720px. Imports `theme.css`. Centered max-width 64rem main column.
  - `+page.svelte` — Overview: hero intro, stats trio (Scenes / Displays / Settings) that wraps to one column on mobile, plus a two-column "Recent scenes" + "Displays" pair (single column on mobile) with online-status dots driven by `lastSeen`.
  - `scenes/+page.svelte` — search-filtered grid of scene rows with a thumbnail preview (live solid color or gradient swatch), name, widget count, default-transition tag, and inline edit/delete actions. Empty state has a centered call-to-action. **Live scene preview:** hovering the thumbnail (pointer devices) pops a floating `<ScenePreviewPopover>` — an `<iframe>` of the read-only kiosk render at `scenes/[id]/preview`; tapping the thumbnail on touch devices (`matchMedia('(hover: none)')`) opens it as a centered modal with backdrop + "Open editor" link instead of navigating.
  - `scenes/[id]/+page.svelte` — full scene editor: metadata, background (solid + gradient with curated presets), typography, drag-and-drop `<WidgetCanvas>`, and per-widget detail cards. (Inherits the theme; not yet rebuilt to match the new aesthetic.)
  - `scenes/[id]/preview/+page@.svelte` — read-only full-viewport render of one scene via the kiosk's `<SceneCanvas>`. The `@` resets to the root layout so it escapes the admin chrome (same shell as the wall display). Fetches `GET /api/scenes/:id/preview` (an assembled `SceneState` — real HA data when connected, mock otherwise; canvas widgets render with `{{ }}` templates unsubstituted since the preview path skips the stateful canvas resolver). No WS, no transitions. Loaded directly for debugging and embedded by the scenes-list preview popover/modal.
  - `displays/+page.svelte` — table of displays (default/active scene, orientation toggle, rotation summary with inline editor, last-seen, assign/activate selects). Wrapped in `.table-wrap` for horizontal scroll on narrow viewports; `min-width` keeps columns readable.
  - `settings/+page.svelte` — safe-area padding form with a live SVG-style preview rectangle that updates as you type. 4-up grid on desktop, 2-up on mobile.

  Everything is **iframe-friendly** so Plan 6's HA sidebar panel mounts the editor without any extra work.
- `src/routes/preview-canvas/+page.svelte` — standalone full-window preview at `/preview-canvas?id=<widgetId>` for canvas authors iterating without scene chrome.

## Conventions

- All animation is CSS-driven (`@keyframes`, `transition`, `background-position`). No JS in the render loop.
- Widgets read `widget.data` directly. They do not fetch or compute data.
- No display-side test suite yet — the end-to-end Playwright smoke in plan verification is the gate.
- The **kiosk** (everything outside `/admin`) keeps inline styles for now; the `.cosmos-admin` design system in `theme.css` is the canonical look for the editor and is the place to add new admin styles.

## Admin design system

- Theme variables are defined under `:root` in `theme.css`. Use them — never hardcode colors.
  - Surfaces: `--c-bg`, `--c-surface`, `--c-surface-2`, `--c-surface-hover`
  - Lines: `--c-line` (subtle), `--c-line-strong`
  - Text: `--c-fg` (primary), `--c-fg-2` (secondary), `--c-fg-3` (muted)
  - Accent: `--c-accent`, `--c-accent-tint` (use accent sparingly — it's the only chromatic color in the palette)
  - Status: `--c-success`, `--c-danger`
- Touch targets are 44px minimum (`--tap`). Buttons, selects, and inputs all inherit this from the global `.cosmos-admin button/input/select` rules.
- Page header pattern: a `<span class="eyebrow">SECTION</span>` above an `<h1>`. Section dividers use `<hr class="hairline">` or `.card` containers.
- Use `.tag` pills for inline metadata (scene type, widget counts, status). Variants: `.muted`, `.accent`, `.success`, `.danger`.
- Use `.reveal .reveal-1` … `.reveal-4` for staggered page-load animations. `prefers-reduced-motion` disables them.
- Mobile breakpoints: stack at <600px (most grids), expand to 2–3 columns at ≥600px, and the topbar swaps from hamburger to pill nav at ≥720px.
- Iframe-safety: avoid `window.open`, fixed-position elements outside the topbar, and non-relative fetch URLs. Cross-origin frames need same-origin to call `/api`.

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
