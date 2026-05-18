<script lang="ts">
  import { onDestroy } from 'svelte';
  import WidgetPalette from '$lib/admin/WidgetPalette.svelte';
  import WidgetCanvas from '$lib/admin/WidgetCanvas.svelte';
  import WidgetInspector from '$lib/admin/WidgetInspector.svelte';
  import { widgetKinds, centeredPositionFor, positionAt } from '$lib/admin/widgetKinds';
  import type { EntityState, Layout, WidgetKind, WidgetState } from '$lib/types';

  export let layout: Layout;
  export let widgets: WidgetState[];
  export let entities: EntityState[] = [];

  let selectedIndex: number | null = null;
  let canvas: WidgetCanvas;

  // Re-clamp selection if the array shrinks underneath us.
  $: if (selectedIndex !== null && selectedIndex >= widgets.length) {
    selectedIndex = widgets.length ? widgets.length - 1 : null;
  }

  function makeWidget(kind: WidgetKind, position: WidgetState['position']): WidgetState {
    return {
      id: crypto.randomUUID(),
      kind,
      position,
      config: widgetKinds[kind].defaultConfig(entities),
      data: null,
    };
  }

  function addCentered(kind: WidgetKind) {
    widgets = [...widgets, makeWidget(kind, centeredPositionFor(kind, layout))];
    selectedIndex = widgets.length - 1;
  }
  function addAt(kind: WidgetKind, col: number, row: number) {
    widgets = [...widgets, makeWidget(kind, positionAt(kind, layout, col, row))];
    selectedIndex = widgets.length - 1;
  }

  function duplicate() {
    if (selectedIndex === null) return;
    const src = widgets[selectedIndex];
    if (!src) return;
    const desiredCol = src.position.col + 1;
    const desiredRow = src.position.row + 1;
    const fitsCol = desiredCol + src.position.w - 1 <= layout.cols;
    const fitsRow = desiredRow + src.position.h - 1 <= layout.rows;
    const pos = fitsCol && fitsRow
      ? { ...src.position, col: desiredCol, row: desiredRow }
      : centeredPositionFor(src.kind, layout);
    const copy: WidgetState = {
      id: crypto.randomUUID(),
      kind: src.kind,
      position: pos,
      config: JSON.parse(JSON.stringify(src.config)) as Record<string, unknown>,
      data: null,
    };
    widgets = [...widgets, copy];
    selectedIndex = widgets.length - 1;
  }

  function remove() {
    if (selectedIndex === null) return;
    const idx = selectedIndex;
    widgets = widgets.filter((_, i) => i !== idx);
    selectedIndex = widgets.length ? Math.min(idx, widgets.length - 1) : null;
  }

  // ── Palette drag tracking ───────────────────────────────────────────────
  // Pointer-event based (not HTML5 dnd) so touch works. Listeners are added on
  // dragstart and torn down on every exit path (pointerup, pointercancel,
  // escape) — mirroring the canvas drag's cleanup discipline.
  type PaletteDrag = {
    kind: WidgetKind;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  };
  let paletteDrag: PaletteDrag | null = null;
  let dropPreview: { col: number; row: number; w: number; h: number } | null = null;

  function teardownPaletteDrag() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', onPaletteMove);
      window.removeEventListener('pointerup', onPaletteUp);
      window.removeEventListener('pointercancel', onPaletteCancel);
      window.removeEventListener('keydown', onPaletteKey);
    }
    paletteDrag = null;
    dropPreview = null;
  }

  function previewCellFor(kind: WidgetKind, clientX: number, clientY: number) {
    const cell = canvas?.pointerCell?.(clientX, clientY);
    if (!cell) return null;
    return positionAt(kind, layout, cell.col, cell.row);
  }

  function onPaletteDragStart(detail: { kind: WidgetKind; clientX: number; clientY: number; pointerId: number }) {
    teardownPaletteDrag();
    paletteDrag = { kind: detail.kind, pointerId: detail.pointerId, startX: detail.clientX, startY: detail.clientY, moved: false };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', onPaletteMove);
      window.addEventListener('pointerup', onPaletteUp);
      window.addEventListener('pointercancel', onPaletteCancel);
      window.addEventListener('keydown', onPaletteKey);
    }
  }
  function onPaletteMove(e: PointerEvent) {
    if (!paletteDrag || e.pointerId !== paletteDrag.pointerId) return;
    if (!paletteDrag.moved) {
      const dx = e.clientX - paletteDrag.startX;
      const dy = e.clientY - paletteDrag.startY;
      if (dx * dx + dy * dy > 16) paletteDrag.moved = true; // ~4px threshold
    }
    if (canvas?.containsPoint?.(e.clientX, e.clientY)) {
      dropPreview = previewCellFor(paletteDrag.kind, e.clientX, e.clientY);
    } else {
      dropPreview = null;
    }
  }
  function onPaletteUp(e: PointerEvent) {
    if (!paletteDrag || e.pointerId !== paletteDrag.pointerId) return;
    const { kind, moved } = paletteDrag;
    const overCanvas = canvas?.containsPoint?.(e.clientX, e.clientY);
    teardownPaletteDrag();
    if (overCanvas) {
      const cell = canvas?.pointerCell?.(e.clientX, e.clientY);
      if (cell) { addAt(kind, cell.col, cell.row); return; }
    }
    // On touch, require a deliberate drag onto the canvas — an off-canvas
    // release (a tap on a chip while trying to scroll the strip, a chip
    // brushed by accident) does nothing. Otherwise the user can't scroll
    // the palette without accidentally placing widgets. Mouse releases still
    // fall through to add-centered, and the keyboard add path (Enter/Space
    // on a focused chip → WidgetPalette's `add` event) keeps "just add it
    // anywhere" reachable from any input.
    if (e.pointerType === 'touch') return;
    if (!moved || !overCanvas) addCentered(kind);
  }
  function onPaletteCancel(e: PointerEvent) {
    if (!paletteDrag || e.pointerId !== paletteDrag.pointerId) return;
    teardownPaletteDrag();
  }
  function onPaletteKey(e: KeyboardEvent) {
    if (e.key === 'Escape') teardownPaletteDrag();
  }

  onDestroy(teardownPaletteDrag);
</script>

<div class="widget-editor">
  <aside class="rail">
    <WidgetPalette
      orientation="rail"
      on:add={(e) => addCentered(e.detail.kind)}
      on:dragstart={(e) => onPaletteDragStart(e.detail)}
    />
  </aside>

  <!-- Narrow-only horizontal palette strip (the rail is hidden < 720px). -->
  <div class="strip">
    <WidgetPalette
      orientation="strip"
      on:add={(e) => addCentered(e.detail.kind)}
      on:dragstart={(e) => onPaletteDragStart(e.detail)}
    />
  </div>

  <div class="canvas-col">
    <WidgetCanvas
      bind:this={canvas}
      {layout}
      bind:widgets
      {selectedIndex}
      onSelect={(i) => (selectedIndex = i)}
      onDeselect={() => (selectedIndex = null)}
      dropPreviewCell={dropPreview}
    />
  </div>

  <aside class="inspector-col" class:empty={selectedIndex === null}>
    {#if selectedIndex !== null && widgets[selectedIndex]}
      <WidgetInspector
        bind:widget={widgets[selectedIndex]}
        {layout}
        {entities}
        on:duplicate={duplicate}
        on:delete={remove}
      />
    {:else}
      <WidgetInspector widget={null} {layout} {entities} />
    {/if}
  </aside>
</div>

<style>
  .widget-editor {
    display: grid;
    gap: 1rem;
    /* Narrow: single column — strip, canvas, inspector. The rail is hidden. */
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'strip'
      'canvas'
      'inspector';
  }
  /* Grid items default to min-width:auto; force 0 so the strip's wide content
     scrolls (overflow-x) instead of stretching the column, and the canvas
     shrinks to fit narrow viewports. */
  .widget-editor > * { min-width: 0; }
  .rail { display: none; }
  .strip { grid-area: strip; }
  .canvas-col { grid-area: canvas; }
  .inspector-col {
    grid-area: inspector;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    padding: var(--r-5);
  }
  /* On narrow viewports the inspector only shows when something's selected;
     when empty it collapses (the strip is the whole story). */
  .inspector-col.empty { display: none; }

  @media (min-width: 720px) {
    .widget-editor {
      grid-template-columns: 176px minmax(0, 1fr) 280px;
      grid-template-areas: 'rail canvas inspector';
      align-items: start;
    }
    .rail {
      display: block;
      grid-area: rail;
      position: sticky;
      top: 1rem;
    }
    .strip { display: none; }
    .inspector-col {
      position: sticky;
      top: 1rem;
      max-height: calc(100vh - 2rem);
      overflow-y: auto;
    }
    /* Always present on desktop — shows the empty-state hint when nothing's
       selected. */
    .inspector-col.empty { display: block; }
  }
</style>
