<script lang="ts">
  import type { WidgetState } from '$lib/types';
  export let widget: WidgetState;

  $: cfg = widget.config as Record<string, unknown>;
  $: content = typeof cfg.content === 'string' ? cfg.content : '';
  $: align = (typeof cfg.align === 'string' ? cfg.align : 'center') as 'left' | 'center' | 'right';
  $: weight = (typeof cfg.weight === 'string' ? cfg.weight : '300') as string;
</script>

<div class="text-widget" style="text-align: {align}; font-weight: {weight};">
  <div class="text-content">{content}</div>
</div>

<style>
  .text-widget {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0.5rem;
    box-sizing: border-box;
  }
  .text-content {
    /* Sized relative to the widget cell so users can scale via the
     * font_scale slider. Wraps on word boundaries; long unbroken
     * tokens (URLs, hashes) still break cleanly via overflow-wrap. */
    font-size: calc(min(10cqmin, 16cqh) * var(--cosmos-font-scale, 1));
    line-height: 1.25;
    white-space: pre-wrap;
    word-break: normal;
    overflow-wrap: anywhere;
    max-width: 100%;
  }
</style>
