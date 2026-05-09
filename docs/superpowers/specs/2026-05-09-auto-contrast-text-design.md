# Auto-contrast text for scene backgrounds

**Status:** Approved 2026-05-09
**Scope:** Single small feature; one implementation plan.

## Problem

The kiosk's default text color is hardcoded to `#f5f5f5` (`display/src/lib/scene/SceneCanvas.svelte:119`). Against a light gradient or a light solid color, white text drops to unreadable contrast. A wall dashboard glanced from across the room must stay legible regardless of background choice.

## Solution

Opt-in **per-scene** flag on `Background`. When enabled, the kiosk computes the average WCAG relative luminance of the active background colors and sets the scene-canvas text color to either `#0a0a0a` (background bright) or `#f5f5f5` (background dim). Threshold is the WCAG-derived 0.179 — above it, black text wins; below, white wins.

A 600 ms `transition: color` smooths the swap when gradient stops change buckets (e.g. `sun_adaptive` day → evening crossing the threshold).

### Why not `mix-blend-mode: difference`?

The first iteration used `color: #fff; mix-blend-mode: difference` for elegance — no math, GPU per-pixel, no recomputation needed. We reverted because `difference` cannot guarantee contrast against mid-tone backgrounds: against a 50% gray, white-difference produces 50% gray, i.e. zero contrast. Animated gradients pass through mid-luminance regions on every frame, surfacing this failure mode visibly.

A luminance-based black/white pick is boring but predictable and ~10 lines of math (no dependency).

## Storage

Extend the `Background` discriminated union in `server/src/store/scenes.ts`:

```ts
export type Background =
  | { type: 'solid'; color: string; auto_contrast?: boolean }
  | {
      type: 'gradient';
      colors: string[];
      speed: 'slow' | 'medium' | 'fast';
      style: 'mesh' | 'linear' | 'radial';
      sun_adaptive?: boolean;
      adaptive_colors?: boolean;
      auto_contrast?: boolean;
    };
```

- Optional, defaults to false (omitted in JSON).
- Persisted in the existing `background_json` column — additive, **no migration**.
- Round-trips through `POST /api/scenes`, `PUT /api/scenes/:id`, and the MCP / agent `patch_scene` tool with no schema changes (validators currently accept arbitrary JSON for background; tighten only if a future plan formalises that).

## Display

New helper `display/src/lib/scene/contrastColor.ts` exporting `pickContrastColor(background): string`:

- Parses each color (3- or 6-digit hex) into normalized sRGB.
- Applies the W3C gamma → linear transform.
- Computes weighted relative luminance (`0.2126·R + 0.7152·G + 0.0722·B`).
- Averages luminance across all stops; returns `#0a0a0a` when avg > 0.179, else `#f5f5f5`.
- Returns `#f5f5f5` (kiosk default) on parse failure.

`display/src/lib/scene/SceneCanvas.svelte`:

1. Reactive `$: contrastColor = scene.background.auto_contrast ? pickContrastColor(scene.background) : null`.
2. Apply `color: ${contrastColor}` inline on `.scene-canvas` when set; otherwise the existing `color: #f5f5f5` default applies.
3. `transition: color 600ms ease` on `.scene-canvas` for smooth swaps when gradient stops cross the luminance threshold.

The kiosk's `display/src/lib/types.ts` `Background` mirror must mirror the new optional field.

## Editor

`display/src/routes/admin/scenes/[id]/+page.svelte`, in the existing background section (≈ line 488). Add a checkbox under the bg-type radios:

```html
<label class="checkbox">
  <input
    type="checkbox"
    checked={background.auto_contrast === true}
    on:change={(e) => { background = { ...background, auto_contrast: e.currentTarget.checked }; }}
  />
  Auto-contrast text
  <span class="hint">Inverts text color per-pixel against the background for guaranteed legibility.</span>
</label>
```

Visible for both solid and gradient. Uses existing admin theme tokens — no new styles.

## Known limitations (documented, not bugs)

- **Canvas widgets inherit `color` but ignore it inside the iframe.** Sandboxed iframes don't read the parent's CSS, so canvas authors who want auto-contrast must implement it inside their content. The `cosmos.tokens` bridge already exposes the resolved color; canvases can read it via `var(--cosmos-fg)` if they choose.
- **Mood video is not factored into the luminance calculation.** The threshold uses only the background gradient/solid stops. Mood videos are typically dark with bright glowing accents (screen-blend), so a black/white text pick chosen for the gradient remains correct in practice.
- **Per-widget hardcoded colors override `color`.** Any widget that sets an explicit `color: ...` in its own CSS bypasses auto-contrast. Today this is only `Weather.svelte`'s glyph tone, which is part of the icon language (intentional).

## Tests

**Server (`server/src/store/scenes.test.ts` or equivalent):**
- Scene round-trip with `background.auto_contrast: true` on a solid background.
- Scene round-trip with `background.auto_contrast: true` on a gradient.
- Verify `auto_contrast` is omitted from JSON when undefined / false (cleanliness, not strictly required).

**Display:** No new unit tests — the change is CSS-only. The existing Playwright kiosk smoke covers it visually.

## Out of scope

- Per-widget opt-out.
- Computed black/white via WCAG luminance (the deferred alternative; revisit only if `mix-blend-mode: difference` proves visually wrong).
- Tinted contrast palettes.
- Auto-detection (always opt-in).
