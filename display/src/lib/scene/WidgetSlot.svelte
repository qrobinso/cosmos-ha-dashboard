<script lang="ts">
  import type { WidgetState } from '$lib/types';
  export let widget: WidgetState;
  export let floatDelay: number = 0;
</script>

<div
  class="widget-slot"
  style="grid-column: {widget.position.col} / span {widget.position.w};
         grid-row: {widget.position.row} / span {widget.position.h};
         --cosmos-float-delay: {floatDelay}s;"
  data-kind={widget.kind}
>
  <slot {widget}>
    <div style="opacity:0.5;font-size:0.875rem">{widget.kind}</div>
  </slot>
</div>

<style>
  .widget-slot {
    --cosmos-edge-fade: 0.6rem;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    container-type: size;
    container-name: widget;
    min-width: 0;
    min-height: 0;
    -webkit-mask-image:
      linear-gradient(to right, transparent 0, black var(--cosmos-edge-fade), black calc(100% - var(--cosmos-edge-fade)), transparent 100%),
      linear-gradient(to bottom, transparent 0, black var(--cosmos-edge-fade), black calc(100% - var(--cosmos-edge-fade)), transparent 100%);
    mask-image:
      linear-gradient(to right, transparent 0, black var(--cosmos-edge-fade), black calc(100% - var(--cosmos-edge-fade)), transparent 100%),
      linear-gradient(to bottom, transparent 0, black var(--cosmos-edge-fade), black calc(100% - var(--cosmos-edge-fade)), transparent 100%);
    -webkit-mask-composite: source-in;
    mask-composite: intersect;
  }
</style>
