<script lang="ts">
  import type { Layout, WidgetState } from '$lib/types';

  export let layout: Layout;
  export let widgets: WidgetState[];
  export let selectedIndex: number | null = null;
  export let onSelect: (idx: number) => void = () => {};

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

  let canvasEl: HTMLDivElement;
  let drag: DragState | null = null;

  function pointerCell(clientX: number, clientY: number): { col: number; row: number } {
    const rect = canvasEl.getBoundingClientRect();
    const cellW = rect.width / layout.cols;
    const cellH = rect.height / layout.rows;
    const col = Math.floor((clientX - rect.left) / cellW) + 1;
    const row = Math.floor((clientY - rect.top) / cellH) + 1;
    return { col, row };
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function startDrag(idx: number, mode: 'move' | 'resize', e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(idx);
    const w = widgets[idx];
    const { col, row } = pointerCell(e.clientX, e.clientY);
    drag = {
      mode,
      widgetIdx: idx,
      pointerId: e.pointerId,
      startCol: w.position.col,
      startRow: w.position.row,
      startW: w.position.w,
      startH: w.position.h,
      startCellX: col,
      startCellY: row,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { col, row } = pointerCell(e.clientX, e.clientY);
    const dCol = col - drag.startCellX;
    const dRow = row - drag.startCellY;
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

  function widgetLabel(w: WidgetState): string {
    if (w.kind === 'entity_tile') {
      const id = (w.config as { entity_id?: string }).entity_id;
      return id ? `${id}` : 'entity_tile';
    }
    return w.kind;
  }
</script>

<div class="canvas-wrap">
  <div
    class="canvas"
    bind:this={canvasEl}
    style="grid-template-columns: repeat({layout.cols}, 1fr); grid-template-rows: repeat({layout.rows}, 1fr); aspect-ratio: {layout.cols} / {layout.rows};"
    on:pointermove={onPointerMove}
    on:pointerup={endDrag}
    on:pointercancel={endDrag}
  >
    {#each Array(layout.cols * layout.rows) as _, i (i)}
      <div class="cell"></div>
    {/each}

    {#each widgets as w, i (w.id)}
      <div
        class="widget-rect"
        class:selected={selectedIndex === i}
        style="grid-column: {w.position.col} / span {w.position.w}; grid-row: {w.position.row} / span {w.position.h};"
        on:pointerdown={(e) => startDrag(i, 'move', e)}
        role="button"
        tabindex="0"
      >
        <span class="label">{widgetLabel(w)}</span>
        <span class="dim">{w.position.w}×{w.position.h}</span>
        <span
          class="resize-handle"
          on:pointerdown={(e) => startDrag(i, 'resize', e)}
          aria-label="Resize"
        ></span>
      </div>
    {/each}
  </div>
  <p class="hint">Drag to move. Drag the bottom-right corner to resize. Click a widget to select it for fine-tuning below.</p>
</div>

<style>
  .canvas-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .canvas {
    position: relative;
    display: grid;
    width: 100%;
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    border-radius: 0.5rem;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }
  .cell {
    border-right: 1px dashed #1f1f1f;
    border-bottom: 1px dashed #1f1f1f;
  }
  .widget-rect {
    position: relative;
    margin: 2px;
    background: rgba(96, 165, 250, 0.18);
    border: 1px solid rgba(96, 165, 250, 0.6);
    border-radius: 0.4rem;
    color: #cfd8ff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    cursor: grab;
    font-size: 0.8rem;
    overflow: hidden;
    padding: 0.25rem;
    box-sizing: border-box;
  }
  .widget-rect:active {
    cursor: grabbing;
  }
  .widget-rect.selected {
    background: rgba(245, 158, 11, 0.22);
    border-color: rgba(245, 158, 11, 0.8);
    color: #ffe5b4;
  }
  .label {
    font-weight: 500;
    text-align: center;
    line-height: 1.1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }
  .dim {
    opacity: 0.6;
    font-size: 0.7rem;
  }
  .resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.6) 50%);
    border-bottom-right-radius: 0.4rem;
  }
  .hint {
    color: #888;
    font-size: 0.8rem;
    margin: 0;
  }
</style>
