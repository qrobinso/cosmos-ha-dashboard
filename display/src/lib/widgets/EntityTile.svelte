<script lang="ts">
  import type { WidgetState, EntityState } from '$lib/types';
  import FitContent from '$lib/scene/FitContent.svelte';
  export let widget: WidgetState;

  $: entity = widget.data as EntityState | null;
  $: domain = entity?.entity_id.split('.')[0] ?? '';
  $: transparent = (widget.config as Record<string, unknown>).transparent === true;

  function fmtBrightness(b: unknown): string {
    return typeof b === 'number' ? `${Math.round((b / 255) * 100)}%` : '';
  }

  function rgbCss(rgb: unknown): string | null {
    if (Array.isArray(rgb) && rgb.length === 3) return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    return null;
  }
</script>

<div class="tile" class:transparent data-domain={domain}>
  <FitContent>
    <div class="tile-body">
      {#if !entity}
        <div class="value">—</div>
      {:else if domain === 'light'}
        {@const swatch = rgbCss(entity.attributes.rgb_color)}
        <div class="row">
          <div class="pill" data-on={entity.state === 'on'}>{entity.state}</div>
          {#if swatch}
            <div class="swatch" style="background:{swatch}"></div>
          {/if}
        </div>
        <div class="sub">{fmtBrightness(entity.attributes.brightness)}</div>
      {:else if domain === 'switch' || domain === 'binary_sensor'}
        <div class="pill" data-on={entity.state === 'on'}>{entity.state}</div>
      {:else if domain === 'sensor'}
        <div class="value">{entity.state}<span class="unit">{entity.attributes.unit_of_measurement ?? ''}</span></div>
      {:else if domain === 'climate'}
        <div class="value">{entity.attributes.current_temperature ?? '—'}°</div>
        <div class="sub">target {entity.attributes.temperature ?? '—'}° · {entity.state}</div>
      {:else if domain === 'lock'}
        <div class="pill" data-on={entity.state === 'locked'}>{entity.state}</div>
      {:else if domain === 'cover'}
        <div class="pill" data-on={entity.state === 'open'}>{entity.state}</div>
        {#if typeof entity.attributes.current_position === 'number'}
          <div class="sub">{entity.attributes.current_position}%</div>
        {/if}
      {:else}
        <div class="value">{entity.state}</div>
      {/if}
    </div>
  </FitContent>
</div>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0.75rem;
    text-align: center;
  }
  /* Transparent mode: drop the card AND the inner state pills + swatch
   * border so the widget shows just text/value floating on the scene. */
  .tile.transparent,
  .tile.transparent .pill,
  .tile.transparent .pill[data-on='true'] {
    background: transparent;
  }
  .tile.transparent .swatch {
    border: none;
  }
  /* FitContent measures this body's natural size and scales it down when
   * content (long sensor values, input_text states, etc.) exceeds the cell. */
  .tile-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    text-align: center;
    white-space: nowrap;
  }
  .value {
    font-size: calc(min(20cqmin, 32cqh) * var(--cosmos-font-scale, 1));
    font-weight: 300;
    line-height: 1;
  }
  .unit {
    font-size: 0.7em;
    opacity: 0.6;
    margin-left: 0.25rem;
  }
  .sub {
    font-size: calc(min(7cqmin, 12cqh) * var(--cosmos-font-scale, 1));
    opacity: 0.6;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .pill {
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    font-size: 0.85rem;
    background: rgba(255, 255, 255, 0.08);
  }
  .pill[data-on='true'] {
    background: rgba(255, 200, 100, 0.25);
  }
  .swatch {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }
</style>
