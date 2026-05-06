<script lang="ts">
  import type { WidgetState } from '$lib/types';
  export let widget: WidgetState;
  export let floatDelay: number = 0;

  // Per-widget corner radius (rem). Read from config; widgets that render
  // their own card (entity_tile, media_player) pick this up via the
  // --cosmos-widget-radius CSS variable for their inner border-radius.
  $: radiusRaw = (widget.config as Record<string, unknown>).border_radius;
  $: radiusRem =
    typeof radiusRaw === 'number' && Number.isFinite(radiusRaw) && radiusRaw >= 0
      ? `${radiusRaw}rem`
      : null;
</script>

<div
  class="widget-slot"
  style="grid-column: {widget.position.col} / span {widget.position.w};
         grid-row: {widget.position.row} / span {widget.position.h};
         --cosmos-float-delay: {floatDelay}s;
         {radiusRem ? `--cosmos-widget-radius: ${radiusRem};` : ''}"
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
  /* Media-player widgets render their own crisp rounded-corner card
   * (per theme), so the slot's edge-fade mask conflicts with the
   * intended look — disable it here. */
  .widget-slot[data-kind='media_player'],
  .widget-slot[data-kind='canvas'] {
    -webkit-mask-image: none;
    mask-image: none;
  }
</style>
