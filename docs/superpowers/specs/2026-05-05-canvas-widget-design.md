# Cosmos Canvas Widget — Design

**Status:** approved · ready for implementation plan
**Date:** 2026-05-05

## Summary

A new `canvas` widget kind that renders user- or agent-authored HTML/CSS/JS inside a sandboxed iframe filling the widget's grid cell. Content can include Home Assistant Jinja templates (`{{ states("sensor.power") }}`) which Cosmos resolves through HA's own WebSocket `render_template` engine — so output is **pin-for-pin compatible with HA's template language** (anything that works in an HA automation works here). The iframe receives a small read-only `cosmos.*` JS bridge over `postMessage` for live entity subscriptions and scene context.

The ultimate goal is to give users and their LLM agents a sandboxed canvas where any UI can be generated on the fly — like an "exersketch" surface, but with first-class access to HA state.

## Goals

- Allow arbitrary HTML/CSS/JS to render inside the bounds of one widget cell.
- Support live data binding to HA entities through a familiar template syntax.
- Stay within Cosmos's existing security posture: tablets never hold an HA token; all HA access is server-mediated.
- Reuse existing widget chrome (transparent toggle, corner radius, edit/duplicate/remove, drag-and-drop placement) so canvas widgets feel native.
- Ship comprehensive documentation as a first-class deliverable.

## Non-goals (v1)

- **No service calls from inside the iframe.** A canvas can read HA state but cannot mutate it. Adding `cosmos.callService(...)` is a deliberate v2 decision behind an editor-level "allow service calls" opt-in.
- **No cross-canvas messaging.** Canvases are isolated; cross-widget choreography is not a v1 concern.
- **No persistent storage shared across renders.** Each canvas reload is stateless from Cosmos's POV.
- **No multiple iframes per scene as a supported pattern.** The editor surfaces a strong recommendation; we don't enforce it but we also don't optimize for it.

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│ Author / Agent                                              │
│   ↳ writes HTML+CSS+JS with {{ ... }} templates             │
│   ↳ stored on `widget.config.content` (string)              │
└──────────────────────────┬──────────────────────────────────┘
                           │ PUT /api/scenes/:id (existing)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Cosmos server                                               │
│  ┌─ assembler.ts (canvas case) ─┐                           │
│  │  resolveCanvas(content)      │                           │
│  │   ↳ TemplatesClient.render() │ ◀──── HA WS               │
│  │   ↳ returns resolved string  │      render_template      │
│  │      + entity dependency ids │      subscription          │
│  └──────────────────────────────┘                           │
│  Canvas widget data: { resolved, liveEntityIds }            │
└──────────────────────────┬──────────────────────────────────┘
                           │ Cosmos WS (existing scene push)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Cosmos display (kiosk)                                      │
│  ┌─ Canvas.svelte ──────────────────────────────┐           │
│  │  iframe sandbox="allow-scripts"              │           │
│  │     srcdoc = resolved + injectedBridge       │           │
│  │     ↕ postMessage                            │           │
│  │  parent forwards entity updates → iframe     │           │
│  │  iframe exposes window.cosmos.* (read-only)  │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

## Detailed design

### 1. Data model

**Widget config** (persisted on the scene):

```ts
{
  kind: 'canvas',
  config: {
    content: string,           // HTML/CSS/JS as-authored, may include {{ ... }}
    transparent?: boolean,     // shared widget toggle
    border_radius?: number,    // shared widget toggle
  }
}
```

`content` is a single string. Templates are not extracted at storage time; the entire content is sent to HA's `render_template` as one Jinja document on each scene assemble. This keeps editor UX simple (one textarea), supports `{% if %}` / `{% for %}` blocks naturally (HA renders the whole thing), and avoids regex-based extraction edge cases.

**Wire format** sent from server to display:

```ts
type CanvasData = {
  /** Content with Jinja templates already substituted. Ready to drop into
   *  iframe `srcdoc` as-is (after the bridge script is appended). */
  resolved: string;
  /** Union of (a) entities the rendered template depends on (reported by
   *  HA) and (b) entities the iframe has explicitly requested via
   *  `cosmos.subscribe(...)` (tracked server-side per widget; see §4). The
   *  display routes state-change events for any id in this list to the
   *  iframe via postMessage. */
  liveEntityIds: string[];
};
```

### 2. Server: TemplatesClient

New module: `server/src/ha/templates.ts`.

```ts
export type TemplateRender = {
  initial: string;
  entityIds: string[];
  unsubscribe: () => void;
};

export type TemplatesClient = {
  render(template: string, onUpdate: (rendered: string, entityIds: string[]) => void): Promise<TemplateRender>;
  close(): void;
};

export function createTemplatesClient(haConn: Connection): TemplatesClient;
```

Implementation:

- Wraps HA's `render_template` WebSocket subscription. HA pushes `{result, listeners: {entities, all, time}}` on the initial render and again on each dependency change.
- **Ref-counted sharing**: identical template strings share one underlying HA subscription. The internal `Map<string, {haUnsubscribe, callbacks: Set, lastResult, lastEntityIds}>` lets multiple canvases (or the same canvas re-resolved) reuse one HA subscription.
- **Errors**: HA returns `{error: string}` for syntax issues. The client returns the error as `initial` (so it surfaces inside the iframe — visible feedback) and logs structured error info server-side.
- **Disconnect**: if HA's WS drops, all in-flight subscriptions are torn down. On reconnect, scenes are re-assembled normally (the existing path) and templates re-render. v1 doesn't try to preserve subscriptions across reconnect.
- **`listeners.all === true`** (template depends on global state) is allowed but logged as a warning. The template will still re-render whenever HA pushes an update for it.

### 3. Server: assembler integration

`server/src/scenes/assembler.ts` `dataFor()` gains:

```ts
case 'canvas': {
  const cfg = widget.config as { content?: unknown };
  const content = typeof cfg.content === 'string' ? cfg.content : '';
  if (!deps.canvasResolver || !content) {
    return { resolved: content, liveEntityIds: [] } as CanvasData;
  }
  const result = await deps.canvasResolver(widget.id, content);
  return { resolved: result.resolved, liveEntityIds: result.entityIds };
}
```

`canvasResolver` is a new optional field on `DataResolvers` (mirrors `resolveCalendarEvents` / `resolveHistory`):

```ts
canvasResolver?: (widgetId: string, content: string) => Promise<{
  resolved: string;
  entityIds: string[];
}>;
```

The host (`server/src/index.ts`) wires this to the `TemplatesClient`. It maintains a `Map<widgetId, () => void>` of cleanup functions per active widget; when a canvas's content changes (or the widget disappears from a scene that's been re-saved), it runs the cleanup and registers a fresh subscription. Hooked into the existing `onSceneChanged` / `onScenesListChanged` flow.

When HA pushes a new rendered value for any active canvas, `canvasResolver`'s `onUpdate` callback fires `markDisplayDirty(displayId)` for every display whose active scene contains the affected widget. The existing 50ms debounced re-push pipeline handles the rest.

### 4. Iframe-side subscription endpoint

When a canvas's JS calls `cosmos.subscribe('sensor.foo')` for an entity that is NOT already in the rendered template's dependency set, the display posts a request to the server:

```
POST /api/canvases/:widgetId/subscribe
Body: { entity_ids: string[] }
→ 204 No Content
```

The server adds the requested ids to a per-widget "extra subscriptions" set, scoped to the requesting display. On the next scene assemble for that display, `CanvasData.liveEntityIds` is computed as the union of (a) entities the resolved template depends on and (b) the extra-subscription set. The display routes state-change events for any id in `liveEntityIds` to the iframe via `postMessage`. Cleanup ties to the WS connection lifecycle: when the display's WS closes, all extra subscriptions for that display are dropped.

This keeps the parent display's subscribe path symmetric with the server-rendered template path: HA still tells us which entities matter; we just know about a few extras the template didn't use.

### 5. Display: Canvas.svelte

New file: `display/src/lib/widgets/Canvas.svelte`. Mounts an iframe and a small `postMessage` bridge.

**Sandbox flags**: `sandbox="allow-scripts"`. No `allow-same-origin`, `allow-top-navigation`, `allow-forms`, `allow-popups`, `allow-pointer-lock`, `allow-modals`. The iframe's origin is `null`; it cannot read parent storage, navigate the top frame, or issue same-origin fetches.

**Bridge injection**: before assigning `srcdoc`, Cosmos appends a single `<script>` block to `widget.data.resolved` that wires up `window.cosmos`. The script is generated server-side as a static asset (`display/src/lib/widgets/canvas-bridge.js`) so it's a known constant; the iframe receives `resolved + bridgeScriptString`.

**Reload key**: the iframe is wrapped in `{#key widget.config.content}` so editing the content triggers a clean remount. Entity-only updates (state pushes via `postMessage`) do NOT re-render the iframe.

**Sizing**: the iframe fills its widget cell (`width: 100%; height: 100%; border: 0; background: transparent`). A `ResizeObserver` on the wrapping div posts `cosmos:context` updates whenever dimensions change.

**Existing widget chrome**:
- The transparent toggle sets `background: transparent` on the iframe (already the default; reused for consistency).
- Corner radius applies on the iframe via `border-radius: var(--cosmos-widget-radius, 0.75rem); overflow: hidden`.
- The slot's edge-fade mask is disabled for `data-kind='canvas'` (same exemption as `media_player`).

### 6. Bridge: postMessage protocol

All messages are JSON-serializable objects with a `type` discriminator.

**Origin/source check**: the iframe verifies `event.source === window.parent` and `event.data?.type?.startsWith('cosmos:')`. The parent verifies `event.source === iframe.contentWindow`.

**Parent → iframe**:

```ts
{ type: 'cosmos:init', context: { size, scene, font }, entities: EntityState[] }
{ type: 'cosmos:state', entity: EntityState }
{ type: 'cosmos:context', context: { size?, scene?, font? } }   // partial updates
```

**Iframe → parent**:

```ts
{ type: 'cosmos:ready' }                             // bridge installed
{ type: 'cosmos:want-entity', entity_ids: string[] } // for cosmos.subscribe to non-templated entity
```

**Inside the iframe**, the bridge exposes:

```ts
window.cosmos = {
  size: { w: number; h: number },
  scene: { id: string; name: string },
  font: { family: string; scale: number },

  entity(entityId: string): EntityState | null,
  subscribe(entityId: string, cb: (s: EntityState) => void): () => void,

  ready: Promise<void>,
  version: string,
};

type EntityState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
};
```

`size`, `scene`, `font` are mutable fields that the bridge updates in place when `cosmos:context` arrives, plus the bridge dispatches a `CustomEvent('cosmos:resize')` on `window` so authors can listen with `window.addEventListener('cosmos:resize', ...)`.

If the parent never receives `cosmos:ready` within 5s, it logs a warning (developer feedback) and proceeds. Most canvases without JS won't post `ready`; this is informational, not fatal.

**No font @font-face cross-origin loading**: because the iframe's origin is `null`, `@font-face` loading from Cosmos's bundled `@fontsource/*` files would fail CORS. The bridge passes the resolved font-family string in `cosmos.font.family`; the iframe applies it as a CSS `font-family` and falls back to system fonts (or the iframe author embeds their own font as a data URL). Documented as a known limitation in the user guide.

### 7. Mock fallback (no HA)

When `haClient` is null OR `templatesClient` is null, the canvas widget renders content unchanged, with literal `{{ ... }}` strings preserved AND a console warning logged on the server. Better than empty: authors see exactly which template is unrendered.

### 8. Editor UX

Selecting "Canvas" as a widget kind shows the existing common controls (Kind / Width / Height / Duplicate / Remove / Transparent / Corner radius) plus a canvas-specific section:

```
┌─ Content ─────────────────────────────────────────────────┐
│ ⓘ How this works ▾  📋 Insert example ▾  🚀 Open preview │
├───────────────────────────────────────────────────────────┤
│ <textarea>                                                │
│  - monospace; resize: vertical; min ~14rem; max ~40rem    │
│  - Tab key inserts a literal tab (preventDefault)         │
└───────────────────────────────────────────────────────────┘
2,341 / 50,000 chars     ← amber > 50KB, no hard limit
```

**"How this works"** — collapsible help panel. Source: `display/src/lib/admin/canvas-help.md`. Covers template syntax (linking to HA's docs), the `cosmos.*` API summary, sandbox limits, and the "one canvas per scene" recommendation with the perf reasoning.

**"Insert example"** — five starter snippets, each ~30–60 lines, self-contained:

1. Hello world — text + a `cosmos.size` readout
2. Templated entity card — one HA Jinja template + a styled box
3. Live gauge — subscribes to a sensor, animates an SVG arc
4. Recipe card — static HTML with image + steps
5. Mood-driven palette — `cosmos.subscribe('sun.sun')` swaps CSS variables

Snippets live in `display/src/lib/admin/canvasExamples.ts`.

**"Open preview"** opens a new browser tab at `/?preview-canvas=<widget-id>`, a small standalone preview page (no scene chrome) that renders just the canvas iframe. Reuses Canvas.svelte.

**Validation**: save is permissive — Cosmos doesn't try to parse HTML. Template syntax errors surface inside the iframe via HA's error response. JS errors are visible only in the iframe's own console (devtools required).

### 9. Documentation

Three documents land with v1:

1. **User guide** — `docs/canvas-widget.md`. ~400–600 lines. Quick-start, template grammar (linked to HA), the `cosmos.*` API reference, sandbox limits, "one canvas per scene" recommendation, authoring tips, the five worked examples (annotated), troubleshooting.

2. **Agent guide** — `docs/canvas-widget-agent.md`. ~150 lines, written as a system-prompt-shaped reference. Contract ("emit only HTML, no markdown fences"), what's available, what's forbidden, style hints (match scene font, use 100% sizing, keep <50KB), a library of completion shapes (number card, chart, animation).

3. **In-product help** — the editor's "How this works" panel + the example snippets dropdown.

CLAUDE.md updates land in the same plan: root, `server/CLAUDE.md`, and `display/CLAUDE.md`.

### 10. Testing

Unit (server-side, since the display has no test harness today):

- **`server/test/templates.test.ts`** — TemplatesClient with a fake HA connection: ref-counted sharing, error surfacing, disconnect handling.
- **`server/test/canvas.test.ts`** — `resolveCanvas` returns the substituted string and entity ids in HA-connected mode; pass-through with empty ids in mock mode.
- **`server/test/assembler.test.ts`** (extend) — canvas widget kind returns CanvasData shape.
- **`server/test/scenes.api.test.ts`** (extend) — canvas widget content round-trips; new `POST /api/canvases/:widgetId/subscribe` endpoint adds ids and returns 404 for unknown widget.

Integration: existing transition smoke fixture gains a canvas widget to confirm the iframe mounts and `srcdoc` populates without errors.

Explicitly NOT tested: the iframe's own JS runtime, HA's template engine, cross-browser sandbox behavior.

## Risks & open questions

- **HA disconnect during active canvases**: v1 simply tears down subscriptions on disconnect; reconnect path requires re-render, which the existing scene-push reactivity handles. If reconnect storms become a thing, we add an exponential-backoff template re-render queue in v2.
- **Bundle weight**: Canvas.svelte adds <2KB; the bridge script is ~1KB. Examples dropdown adds <10KB. Total impact on the kiosk bundle is negligible.
- **Iframe memory cost**: per the design, "one canvas per scene" is a strong recommendation but not enforced. We surface this in editor + docs and trust users.
- **Template rendering latency**: HA's `render_template` is fast (sub-10ms typical), but adds a round-trip to scene assembly. For displays with many widgets this is parallelizable; not a v1 problem.

## Migration & backwards compatibility

- New widget kind `canvas` is additive. Existing scenes are unaffected.
- The shared widget chrome (transparent, border_radius) is reused; no schema migration needed for those fields.
- HA users on older versions (pre-`render_template` WS subscription, very old) will see canvases render as-is with literal `{{ }}` and a server warning. `render_template` has been stable in HA for years; this is a non-issue in practice.
