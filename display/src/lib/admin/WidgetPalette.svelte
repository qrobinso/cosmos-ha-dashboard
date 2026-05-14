<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { paletteGroups } from '$lib/admin/widgetKinds';
  import { widgetIconSvg } from '$lib/admin/widgetIcons';
  import type { WidgetKind } from '$lib/types';

  /** 'rail' = vertical grouped list (desktop sidebar). 'strip' = horizontal
   *  scroll of chips (narrow viewports, above the canvas). */
  export let orientation: 'rail' | 'strip' = 'rail';

  const dispatch = createEventDispatcher<{
    /** Keyboard activation (Enter/Space) → add centered. Pointer-driven adds
     *  go through `dragstart` + the editor's gesture, not this. */
    add: { kind: WidgetKind };
    /** Pointer pressed on a palette item; the editor tracks pointermove/up
     *  to either drop at a cell (over the canvas) or add centered (a tap that
     *  didn't move). `clientX/Y` is the pointerdown origin. */
    dragstart: { kind: WidgetKind; clientX: number; clientY: number; pointerId: number };
  }>();

  const groups = paletteGroups();

  function onPointerDown(kind: WidgetKind, e: PointerEvent) {
    // Left button / primary touch only.
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dispatch('dragstart', { kind, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId });
  }
  function onClick(kind: WidgetKind, e: MouseEvent) {
    // detail === 0 → synthesized by keyboard (Enter/Space). Mouse/touch clicks
    // (detail >= 1) are already handled by the editor's pointer gesture.
    if (e.detail === 0) dispatch('add', { kind });
  }
</script>

<div class="palette" class:strip={orientation === 'strip'} class:rail={orientation === 'rail'}>
  {#each groups as g (g.category)}
    <div class="group">
      <span class="eyebrow group-label">{g.label}</span>
      <div class="items">
        {#each g.kinds as k (k.kind)}
          <button
            type="button"
            class="item"
            style="--item-accent: {k.accent};"
            title={k.blurb}
            aria-label="{k.label} — {k.blurb}"
            on:pointerdown={(e) => onPointerDown(k.kind, e)}
            on:click={(e) => onClick(k.kind, e)}
          >
            <span class="item-ic" aria-hidden="true">{@html widgetIconSvg(k.kind, 18)}</span>
            <span class="item-name">{k.label}</span>
          </button>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .palette {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  .palette.strip {
    flex-direction: row;
    gap: 1.25rem;
    overflow-x: auto;
    padding-bottom: 0.35rem;
    /* momentum scroll on the touch tablet */
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .palette.strip .group {
    flex-shrink: 0;
  }
  .group-label {
    padding-left: 0.15rem;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .palette.strip .items {
    flex-direction: row;
    gap: 0.4rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    min-height: 2.4rem;
    padding: 0 0.65rem;
    text-align: left;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    color: var(--c-fg-2);
    cursor: grab;
    font-size: 0.85rem;
    transition: background 130ms var(--ease), border-color 130ms var(--ease), color 130ms var(--ease), transform 80ms var(--ease);
    touch-action: none;
  }
  .palette.strip .item {
    width: auto;
    white-space: nowrap;
    /* On mobile, horizontal finger pans should scroll the strip (the browser
       handles pan-x), not be hijacked as a drag-to-canvas gesture. Vertical
       movement still falls through to our pointer handlers as drag intent. */
    touch-action: pan-x;
  }
  .item:hover {
    background: var(--c-surface-2);
    border-color: color-mix(in srgb, var(--item-accent) 45%, var(--c-line));
    color: var(--c-fg);
  }
  .item:active {
    cursor: grabbing;
    transform: scale(0.98);
  }
  .item:focus-visible {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-tint);
  }
  .item-ic {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: var(--r-1);
    color: var(--item-accent);
    background: color-mix(in srgb, var(--item-accent) 15%, transparent);
  }
  .item-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
