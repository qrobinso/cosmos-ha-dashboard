<script lang="ts">
  import type { WidgetState } from '$lib/types';
  export let widget: WidgetState;
</script>

<div
  class="widget-slot"
  style="grid-column: {widget.position.col} / span {widget.position.w};
         grid-row: {widget.position.row} / span {widget.position.h};"
  data-kind={widget.kind}
>
  <slot {widget}>
    <!-- Placeholder until widgets land in Tasks 9-11 -->
    <div style="opacity:0.5;font-size:0.875rem">{widget.kind}</div>
  </slot>
</div>

<style>
  .widget-slot {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
</style>
