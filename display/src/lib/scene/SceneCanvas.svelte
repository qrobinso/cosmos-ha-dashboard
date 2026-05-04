<script lang="ts">
  import type { SceneState } from '$lib/types';
  import WidgetSlot from './WidgetSlot.svelte';
  import Clock from '$lib/widgets/Clock.svelte';
  import Weather from '$lib/widgets/Weather.svelte';
  import EntityTile from '$lib/widgets/EntityTile.svelte';

  export let scene: SceneState;
</script>

<div class="scene-canvas">
  <div class="background-layer" data-bg-type={scene.background.type}>
    <slot name="background" background={scene.background} />
  </div>
  <div
    class="widget-layer"
    style="grid-template-columns: repeat({scene.layout.cols}, 1fr);
           grid-template-rows: repeat({scene.layout.rows}, 1fr);"
  >
    {#each scene.widgets as widget (widget.id)}
      <WidgetSlot {widget} let:widget={w}>
        {#if w.kind === 'clock'}
          <Clock widget={w} />
        {:else if w.kind === 'weather'}
          <Weather widget={w} />
        {:else if w.kind === 'entity_tile'}
          <EntityTile widget={w} />
        {/if}
      </WidgetSlot>
    {/each}
  </div>
</div>

<style>
  .scene-canvas {
    position: fixed;
    inset: 0;
    overflow: hidden;
    color: #f5f5f5;
  }
  .background-layer {
    position: absolute;
    inset: 0;
    z-index: 0;
  }
  .widget-layer {
    position: absolute;
    inset: 0;
    display: grid;
    gap: 1rem;
    padding: 1rem;
    z-index: 1;
  }
</style>
