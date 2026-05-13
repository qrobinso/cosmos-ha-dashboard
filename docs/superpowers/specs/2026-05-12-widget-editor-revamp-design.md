# Widget editor revamp — first-class drag-and-drop widget experience

**Status:** Designed, awaiting plan
**Date:** 2026-05-12

## Problem

The scene editor's widget section ([display/src/routes/admin/scenes/[id]/+page.svelte](../../../display/src/routes/admin/scenes/%5Bid%5D/+page.svelte), ~1500 lines) is clunky:

- **Adding a widget is dumb.** `+ Add widget` always spawns a `clock`; to get any other kind you add a clock, then change a `<select>`. There's no sense of "what can I add".
- **Every widget's config is on screen at once.** Below the canvas, each widget renders a flat card with its full raw config — 10+ `show_*` toggles for `media_player`, etc. A scene with five widgets is a wall of forms. Selecting a widget on the canvas only highlights it; it doesn't focus the editing surface.
- **The canvas tiles are anonymous.** Every widget is the same blue box with the kind string. No type identity, no entity hint.
- **The aesthetic isn't applied.** This page predates the `.cosmos-admin` design system and still uses ad-hoc colors; the rest of admin uses `theme.css` tokens.

The drag-and-drop grid mechanic itself ([display/src/lib/admin/WidgetCanvas.svelte](../../../display/src/lib/admin/WidgetCanvas.svelte) — pointer-event move/resize, arrow-key nudge, shift-arrow resize) is good and stays. We build on it.

## Locked design decisions

Validated with the user via the visual companion:

1. **Layout — three-pane on desktop, stacked on narrow.** Palette rail (left) · drag-and-drop canvas (center) · contextual inspector (right) for the selected widget. Below ~720px (admin's existing breakpoint) it collapses to a vertical flow: horizontal palette strip → canvas → inspector. No separate mobile design — the same components reflow.
2. **Canvas tiles — "iconic".** Each tile shows a kind-colored icon + the widget's friendly name + a meta line (bound entity for entity-bearing kinds, or `W×H` cells). Tiles too small for all three fall back to icon-only. The amber "selected" treatment stays. (Live mini-preview rendering of the real widget is **deferred to v2** — see Out of scope.)
3. **Palette — compact, grouped.** Icon + name per entry, organized into three small categories: **Time & info** (clock, text), **Home Assistant** (weather, entity tile, calendar, media player, chart/statistics, camera), **Canvas** (custom canvas). Hover tooltip gives the one-line description. Two ways to add: **drag a palette item onto the grid** (drops at the cell under the pointer) or **click it** (drops centered). Pointer-event based, consistent with the existing canvas drag — works for touch.
4. **Inspector — sectioned scroll.** One scrollable pane. Header: editable widget name (`config.name` where it exists / falls back to kind label), kind label, duplicate action, delete action. Body groups the kind's config fields under quiet section labels in this order: **Source** (entity picker + source-shaping options like `forecast_type`), **Content** (the `show_*` / element-toggle group), **Style** (colors, weights, density, units), **Placement** (col / row / w / h numeric inputs mirroring the canvas rect, plus a kind `<select>` to re-type the widget in place). Empty selection → the pane shows a short "Select a widget, or drag one from the palette to add it" hint.
5. `.cosmos-admin` theme tokens throughout (`--c-surface`, `--c-line`, `--c-fg`/`--c-fg-2`/`--c-fg-3`, `--c-accent`, `--tap`, the hairline + radius conventions).

## Architecture

A new self-contained widget-editor module under `display/src/lib/admin/`, dropped into the scene editor page in place of the current "Widgets" `<section>`. The rest of the page (background, typography, mood, save) is untouched except for removing the now-relocated widget helpers.

```
display/src/lib/admin/
  widgetKinds.ts            ← NEW. Single registry of widget-kind metadata.
  WidgetEditor.svelte       ← NEW. Layout shell: palette + canvas + inspector,
                                responsive (3-pane ↔ stacked). Owns selection state.
  WidgetPalette.svelte      ← NEW. Compact grouped palette. Drag-to-place + click-to-add.
  WidgetCanvas.svelte       ← MODIFIED. Iconic tiles; accepts drops from the palette;
                                keeps existing move/resize/keyboard.
  WidgetInspector.svelte    ← NEW. Header (name/kind/dup/delete) + sectioned body.
                                Delegates per-kind fields to widgets/<kind>.svelte.
  widgets/
    ClockConfig.svelte      ← NEW (×9, one per kind). The per-kind field group,
    WeatherConfig.svelte         each exporting { config, entities } props and
    EntityTileConfig.svelte      emitting config changes. Section grouping
    CalendarConfig.svelte        (Source/Content/Style) lives inside each one.
    MediaPlayerConfig.svelte
    StatisticsConfig.svelte
    TextConfig.svelte
    CameraConfig.svelte
    CanvasConfig.svelte
```

### `widgetKinds.ts` — the registry

Replaces the scattered `WIDGET_KINDS`, `WIDGET_KIND_LABELS`, the giant `setWidgetKind(idx, kind)` switch, the `centeredPosition` size defaults, and the `firstEntityOfDomain` calls embedded in those defaults. One exported array (or `Record<WidgetKind, …>`):

```ts
type WidgetKindMeta = {
  kind: WidgetKind;
  label: string;            // "Weather"
  category: 'time' | 'ha' | 'canvas';
  icon: string;             // a small inline-SVG path or icon name (see Icons below)
  accent: string;           // theme-friendly hex/hsl for the tile icon chip + palette icon
  blurb: string;            // one-liner for the palette tooltip ("Current conditions + forecast")
  defaultSize: { w: number; h: number };
  /** Build the initial config for a freshly-added or re-typed widget.
   *  `entities` is the cached HA entity list so domain-bearing kinds can
   *  pick a sensible first match (the current `firstEntityOfDomain` logic). */
  defaultConfig: (entities: EntityState[]) => Record<string, unknown>;
  /** The user-facing name for a widget instance (for the inspector header /
   *  canvas tile). Most kinds: the label; entity kinds: friendly name or entity_id. */
  instanceLabel: (config: Record<string, unknown>) => string;
};
```

`addWidget(kind)`, `setWidgetKind(idx, kind)`, and `duplicateWidget` all read from this. The page shrinks substantially.

### `WidgetEditor.svelte` — the shell

Props: `layout`, `widgets` (two-way bound array, as today), `entities`. Owns `selectedIndex: number | null`. Renders:

- **Desktop (≥720px):** CSS grid, three columns — palette (fixed ~200px) | canvas (flex) | inspector (fixed ~300px). Inspector column always present; shows the empty-state hint when `selectedIndex == null`.
- **Narrow (<720px):** single column — `WidgetPalette` in a horizontal-scroll strip variant, then `WidgetCanvas`, then `WidgetInspector` (full width, only when something is selected; otherwise the palette strip is the whole story).

Wires: palette `add` events → `addWidget` (centered) or `addAt(cell)` (from a drop) → push to `widgets`, set `selectedIndex` to the new one; canvas `select` → `selectedIndex`; canvas `drop` (palette item released over a cell) → `addAt`; inspector `change` → mutate `widgets[selectedIndex].config` / `.kind` / `.position`; inspector `duplicate` / `delete` → existing logic, relocated.

### `WidgetCanvas.svelte` changes

Keep all current behavior (pointer move/resize, `nudge`/`resizeBy`, arrow keys, clamping, `aria-label`). Changes:

- **Tile rendering** → iconic: `<div class="tile">` with a `.tile-icon` chip (background `accent` at low alpha, the kind icon), `.tile-name` (`meta.instanceLabel(w.config)`), `.tile-meta` (bound `entity_id` if the config has one, else `W×H`). When the rendered tile is below a size threshold (compute from grid-cell px or just `w*h <= 2`), render icon-only, centered. Selected = amber as today.
- **Accept palette drops.** A new prop `dropPreviewCell: {col,row} | null` (driven by the editor while a palette drag is in flight) renders a dashed ghost rect at that cell. The editor listens to the global pointermove during a palette drag, maps to a cell via the canvas's existing `pointerCell` (expose it, or move the in-flight tracking into the canvas — implementer's call), and on pointerup over the canvas dispatches `drop` with the cell. Clamp the drop cell so the default-size widget fits.
- Use theme tokens for colors (cells, tile fill, selected state, hint text).
- Drop the prose `<p class="hint">` in favor of a single concise line styled as `.tag.muted` or `--c-fg-3`; key affordances (drag to move, drag corner to resize, arrows to nudge) move into `aria-label` + a small `?`-tooltip rather than always-on body text.

### `WidgetInspector.svelte`

Props: `widget` (the selected one), `entities`. Header row: `meta.icon` chip · editable text input bound to `config.name` (for kinds without a `name` field — clock, weather, etc. — it still writes `config.name`; the renderers ignore unknown keys, and the canvas tile / inspector use it for display, mirroring how `canvas.config.name` already works) · kind label as a muted tag · `⧉ Duplicate` · `🗑 Delete` (delete is a `confirmRequired`-style two-step or a small confirm — match how the page deletes today). Body: a `<select>` for kind (re-types in place via `setWidgetKind`), then `<svelte:component this={configComponentFor(widget.kind)} bind:config={widget.config} {entities} />`, then the **Placement** section (4 small number inputs for col/row/w/h, clamped to layout bounds, two-way bound to `widget.position` — editing here moves the canvas rect and vice versa). Empty-state variant when no `widget` prop: the hint text, theme-styled.

### `widgets/<Kind>Config.svelte` (×9)

Each one is the relocated `{#if w.kind === '...'}` block from the current page, restructured: fields wrapped in `.section` groups with a `<span class="eyebrow">SOURCE</span>` / `CONTENT` / `STYLE` header (admin's existing eyebrow pattern), using `Field.svelte` for label+control pairs, `EntityPicker.svelte` for entity selection (unchanged), theme-styled inputs (44px touch targets come free from `.cosmos-admin input/select`). Props: `config` (two-way bound), `entities`. No business logic beyond what's there today — this is a relocation + reorganization + restyle, not a rethink of what each widget exposes. Keep the existing list-editing helpers (`moveListItem`/`addToList`/`removeFromList` for things like weather's secondary-info list) — move them into a tiny shared `widgets/listConfig.ts` rather than re-implementing per kind.

### Icons

Need a small inline-SVG set for the 9 kinds (clock, weather, entity, calendar, media player, chart, text, camera, canvas). The kiosk already ships some SVG (e.g. fullscreen chevrons); admin has none yet. Add `display/src/lib/admin/widgetIcons.ts` exporting a `Record<WidgetKind, string>` of `<path>` `d` data (or full `<svg>` strings), drawn in a consistent 24×24 stroke style matching the existing kiosk SVGs (`stroke-width: 1.7`, round caps). Keep it tiny — these render at ~18–24px.

## Data flow

No new server state, no new endpoints, no schema change. Everything stays in the existing `widgets` array the page already binds and `POST`s on save. `config.name` for non-canvas kinds is a new soft convention (an extra key the server stores verbatim and renderers ignore) — call it out in `display/CLAUDE.md` so future widget authors know tiles/inspector key off it.

## Out of scope (carry forward)

- **Live mini-preview tiles** (rendering the actual widget component, scaled, with mock data, inside the canvas rect). Genuinely "world-class" but needs a mock-data fixture per kind and careful scaling — a v2 layered on top of the iconic tiles. The `widgetKinds` registry should leave room for a future `previewComponent` field.
- **Splitting the 1500-line page further** beyond extracting the widget editor. The background / typography / mood panels could each become components too, but that's not what this is about.
- **Multi-select / group-move / alignment guides** on the canvas. One widget at a time, as today.
- **Drag-to-reorder in the palette**, palette search/filter — the grouped list is short enough.
- **Undo/redo** for editor actions.
- **Touch-specific gestures** beyond what pointer events give us for free.

## Testing & verification

No display-side test suite exists (per `display/CLAUDE.md`). Verification gates:

1. `npm --workspace display run build` — clean, no TS errors.
2. Manual smoke (document the checklist in the implementer's report):
   - Add a widget by clicking a palette item → drops centered, gets selected, inspector shows its config.
   - Add a widget by dragging a palette item onto a grid cell → drops at that cell.
   - Select an existing widget on the canvas → inspector switches to it; deselect → empty-state hint.
   - Move / resize via drag and via arrow / shift-arrow keys still work; Placement number inputs and the canvas rect stay in sync.
   - Change a widget's kind via the inspector `<select>` → config resets to that kind's defaults, tile icon/name update.
   - Duplicate / delete from the inspector header behave as before.
   - Resize the browser below 720px → layout collapses to palette strip → canvas → inspector, everything still operable.
   - Edit a config field (e.g. weather entity, a `show_*` toggle), save the scene, reload → persisted.
3. `npm --workspace server test` — should be unaffected (no server changes); run it to confirm.

## Risks

- **Pointer-event palette drag across the page** (palette item → over the canvas → release): the global pointermove/up listeners during an in-flight palette drag must be cleaned up on every exit path (pointerup anywhere, pointercancel, escape). The existing canvas drag already does pointer capture cleanly; mirror that discipline. Test on touch.
- **The 9 per-kind config sub-components** are a lot of small files. They're mechanical relocations, but it's the bulk of the diff — easy to introduce a regression by mis-copying a field. The build catches type errors; the manual save-and-reload check catches semantic ones.
- **`config.name` on non-canvas kinds** — confirm the server's scene `PUT`/`POST` validators don't reject unknown config keys (they currently accept any JSON shape per the known-tech-debt note — so this is fine, but verify).
- **Theme migration of this page** — some of the surrounding (out-of-scope) panels share CSS with the widget section today. Extracting the widget editor must not break the background/typography/mood panels' styling. Scope CSS to the new components; leave the page's existing `<style>` for the panels we're not touching.
