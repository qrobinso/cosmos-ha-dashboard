<script lang="ts">
  import { widgetKinds } from '$lib/admin/widgetKinds';
  import { widgetIconSvg } from '$lib/admin/widgetIcons';
  import type { Layout, WidgetKind, WidgetState } from '$lib/types';

  export let layout: Layout;
  export let widgets: WidgetState[];
  export let selectedIndex: number | null = null;
  export let onSelect: (idx: number) => void = () => {};
  /** Called when empty canvas space is pressed → deselect. */
  export let onDeselect: () => void = () => {};
  /** Driven by the editor while a palette item is being dragged over the
   *  canvas: the cell + size its default-size widget would land on, or null. */
  export let dropPreviewCell: { col: number; row: number; w: number; h: number } | null = null;

  let canvasEl: HTMLDivElement | undefined;

  type DragState = {
    mode: 'move' | 'resize';
    widgetIdx: number;
    pointerId: number;
    startCol: number;
    startRow: number;
    startW: number;
    startH: number;
    startCellX: number;
    startCellY: number;
  };

  let drag: DragState | null = null;

  /** Map a client point to a 1-indexed grid cell. Exported so the editor can
   *  resolve a palette drag's drop target against this canvas. */
  export function pointerCell(clientX: number, clientY: number): { col: number; row: number } | null {
    if (!canvasEl) return null;
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const cellW = rect.width / layout.cols;
    const cellH = rect.height / layout.rows;
    const col = Math.floor((clientX - rect.left) / cellW) + 1;
    const row = Math.floor((clientY - rect.top) / cellH) + 1;
    return { col, row };
  }

  /** True if the point is inside the canvas rect. */
  export function containsPoint(clientX: number, clientY: number): boolean {
    if (!canvasEl) return false;
    const r = canvasEl.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function startDrag(idx: number, mode: 'move' | 'resize', e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(idx);
    const w = widgets[idx];
    const cell = pointerCell(e.clientX, e.clientY);
    if (!cell) return;
    drag = {
      mode,
      widgetIdx: idx,
      pointerId: e.pointerId,
      startCol: w.position.col,
      startRow: w.position.row,
      startW: w.position.w,
      startH: w.position.h,
      startCellX: cell.col,
      startCellY: cell.row,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const cell = pointerCell(e.clientX, e.clientY);
    if (!cell) return;
    const dCol = cell.col - drag.startCellX;
    const dRow = cell.row - drag.startCellY;
    const w = widgets[drag.widgetIdx];

    if (drag.mode === 'move') {
      const newCol = clamp(drag.startCol + dCol, 1, layout.cols - w.position.w + 1);
      const newRow = clamp(drag.startRow + dRow, 1, layout.rows - w.position.h + 1);
      if (newCol !== w.position.col || newRow !== w.position.row) {
        w.position = { ...w.position, col: newCol, row: newRow };
        widgets = widgets;
      }
    } else {
      const newW = clamp(drag.startW + dCol, 1, layout.cols - w.position.col + 1);
      const newH = clamp(drag.startH + dRow, 1, layout.rows - w.position.row + 1);
      if (newW !== w.position.w || newH !== w.position.h) {
        w.position = { ...w.position, w: newW, h: newH };
        widgets = widgets;
      }
    }
  }

  function endDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
  }

  // Pressing empty canvas space (tiles call stopPropagation, so anything that
  // reaches here is the grid background) clears the selection.
  function onCanvasPointerDown(e: PointerEvent) {
    if (drag) return;
    if (e.target === canvasEl || (e.target as HTMLElement)?.classList?.contains('cell')) {
      onDeselect();
    }
  }

  /** Move a widget by whole grid cells, clamped to the layout bounds. */
  function nudge(idx: number, dCol: number, dRow: number) {
    const w = widgets[idx];
    const newCol = clamp(w.position.col + dCol, 1, layout.cols - w.position.w + 1);
    const newRow = clamp(w.position.row + dRow, 1, layout.rows - w.position.h + 1);
    if (newCol === w.position.col && newRow === w.position.row) return;
    w.position = { ...w.position, col: newCol, row: newRow };
    widgets = widgets;
  }

  /** Resize a widget by whole grid cells, clamped to >= 1 and the layout edge. */
  function resizeBy(idx: number, dW: number, dH: number) {
    const w = widgets[idx];
    const newW = clamp(w.position.w + dW, 1, layout.cols - w.position.col + 1);
    const newH = clamp(w.position.h + dH, 1, layout.rows - w.position.row + 1);
    if (newW === w.position.w && newH === w.position.h) return;
    w.position = { ...w.position, w: newW, h: newH };
    widgets = widgets;
  }

  // Arrow keys move the focused widget; Shift+arrow resizes it.
  function onWidgetKeydown(idx: number, e: KeyboardEvent) {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    onSelect(idx);
    if (e.shiftKey) resizeBy(idx, d[0], d[1]);
    else nudge(idx, d[0], d[1]);
  }

  function meta(kind: WidgetKind) {
    return widgetKinds[kind];
  }
  function tileLabel(w: WidgetState): string {
    return widgetKinds[w.kind].instanceLabel(w.config);
  }
  function tileMeta(w: WidgetState): string {
    const entityId = (w.config as { entity_id?: unknown }).entity_id;
    if (typeof entityId === 'string' && entityId.trim()) return entityId.trim();
    return `${w.position.w}×${w.position.h}`;
  }
  function ariaFor(w: WidgetState): string {
    return `${tileLabel(w)} (${widgetKinds[w.kind].label}), ${w.position.w} by ${w.position.h} cells at column ${w.position.col}, row ${w.position.row}. Drag to move, drag the corner to resize. Arrow keys move, Shift+arrow resizes.`;
  }
</script>

<div class="canvas-wrap">
  <div
    class="canvas"
    bind:this={canvasEl}
    style="grid-template-columns: repeat({layout.cols}, 1fr); grid-template-rows: repeat({layout.rows}, 1fr); aspect-ratio: {layout.cols} / {layout.rows};"
    on:pointerdown={onCanvasPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={endDrag}
    on:pointercancel={endDrag}
  >
    {#each Array(layout.cols * layout.rows) as _, i (i)}
      <div class="cell"></div>
    {/each}

    {#if dropPreviewCell}
      <div
        class="drop-ghost"
        style="grid-column: {dropPreviewCell.col} / span {dropPreviewCell.w}; grid-row: {dropPreviewCell.row} / span {dropPreviewCell.h};"
        aria-hidden="true"
      ></div>
    {/if}

    {#each widgets as w, i (w.id)}
      {@const m = meta(w.kind)}
      {@const small = w.position.w * w.position.h <= 2}
      <div
        class="tile"
        class:selected={selectedIndex === i}
        class:compact={small}
        style="grid-column: {w.position.col} / span {w.position.w}; grid-row: {w.position.row} / span {w.position.h}; --tile-accent: {m.accent};"
        on:pointerdown={(e) => startDrag(i, 'move', e)}
        on:keydown={(e) => onWidgetKeydown(i, e)}
        on:focus={() => onSelect(i)}
        role="button"
        tabindex="0"
        aria-label={ariaFor(w)}
      >
        <span class="tile-ic" aria-hidden="true">{@html widgetIconSvg(w.kind, 18)}</span>
        {#if !small}
          <span class="tile-name">{tileLabel(w)}</span>
          <span class="tile-meta">{tileMeta(w)}</span>
        {/if}
        <span class="resize-handle" on:pointerdown={(e) => startDrag(i, 'resize', e)} aria-hidden="true"></span>
      </div>
    {/each}
  </div>
  <p class="hint">
    Drag tiles to arrange · drag a corner to resize · click to edit
    <span class="help" tabindex="0" role="button" aria-label="Keyboard help">
      ?
      <span class="help-bubble" role="tooltip">Click a tile to select it, then arrow keys nudge it one cell and Shift+arrow resizes it.</span>
    </span>
  </p>
</div>

<style>
  .canvas-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .canvas {
    position: relative;
    display: grid;
    width: 100%;
    background:
      radial-gradient(ellipse 80% 60% at 50% 0%, color-mix(in srgb, var(--c-cool) 4%, transparent), transparent 70%),
      var(--c-bg);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    overflow: hidden;
    user-select: none;
  }
  .cell {
    border-right: 1px dashed var(--c-line);
    border-bottom: 1px dashed var(--c-line);
  }
  .drop-ghost {
    margin: 3px;
    border: 1.5px dashed var(--c-accent);
    border-radius: var(--radius-sm);
    background: var(--c-accent-tint);
    pointer-events: none;
  }
  .tile {
    position: relative;
    margin: 3px;
    background:
      linear-gradient(160deg, color-mix(in srgb, var(--tile-accent) 14%, transparent), color-mix(in srgb, var(--tile-accent) 6%, transparent)),
      var(--c-surface);
    border: 1px solid color-mix(in srgb, var(--tile-accent) 38%, var(--c-line));
    border-radius: var(--radius-sm);
    color: var(--c-fg-2);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.2rem;
    cursor: grab;
    overflow: hidden;
    padding: 0.4rem 0.55rem;
    box-sizing: border-box;
    touch-action: none;
    transition: border-color 120ms var(--ease), box-shadow 120ms var(--ease);
  }
  .tile.compact {
    align-items: center;
    justify-content: center;
    padding: 0.2rem;
  }
  .tile:active { cursor: grabbing; }
  .tile:hover { border-color: color-mix(in srgb, var(--tile-accent) 60%, var(--c-line)); }
  .tile.selected {
    background:
      linear-gradient(160deg, var(--c-accent-tint), color-mix(in srgb, var(--c-accent) 7%, transparent)),
      var(--c-surface);
    border-color: var(--c-accent);
    box-shadow: 0 0 0 1px var(--c-accent), 0 4px 16px color-mix(in srgb, var(--c-accent) 14%, transparent);
    color: var(--c-fg);
  }
  .tile:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
  }
  .tile-ic {
    display: grid;
    place-items: center;
    color: var(--tile-accent);
    flex-shrink: 0;
  }
  .tile.selected .tile-ic { color: var(--c-accent-hot); }
  .tile-name {
    font-size: 0.8rem;
    font-weight: 500;
    line-height: 1.15;
    color: var(--c-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .tile-meta {
    font-family: var(--f-mono);
    font-size: 0.66rem;
    color: var(--c-fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 24px;
    height: 24px;
    cursor: nwse-resize;
    touch-action: none;
    background:
      linear-gradient(135deg, transparent 62%, color-mix(in srgb, var(--c-fg) 55%, transparent) 62%, color-mix(in srgb, var(--c-fg) 55%, transparent) 78%, transparent 78%),
      linear-gradient(135deg, transparent 82%, color-mix(in srgb, var(--c-fg) 55%, transparent) 82%);
    border-bottom-right-radius: var(--radius-sm);
  }
  .hint {
    color: var(--c-fg-3);
    font-size: 0.78rem;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .help {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 1.15rem;
    height: 1.15rem;
    border-radius: 999px;
    border: 1px solid var(--c-line-strong);
    font-size: 0.7rem;
    color: var(--c-fg-3);
    cursor: help;
  }
  .help:hover, .help:focus-visible { color: var(--c-fg); outline: none; }
  .help-bubble {
    position: absolute;
    bottom: calc(100% + 0.4rem);
    left: 0;
    z-index: 20;
    width: 16rem;
    padding: 0.55rem 0.7rem;
    background: var(--c-surface);
    border: 1px solid var(--c-line-strong);
    border-radius: var(--radius-sm);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    color: var(--c-fg-2);
    font-size: 0.78rem;
    line-height: 1.4;
    opacity: 0;
    visibility: hidden;
    transform: translateY(3px);
    transition: opacity 130ms var(--ease), transform 130ms var(--ease), visibility 0s linear 130ms;
    pointer-events: none;
  }
  .help:hover .help-bubble, .help:focus-visible .help-bubble {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
    transition-delay: 0s;
  }
</style>
