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
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    container-type: size;
    container-name: widget;
    min-width: 0;
    min-height: 0;
  }
</style>
