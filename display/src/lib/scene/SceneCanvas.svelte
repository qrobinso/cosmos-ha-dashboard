<script lang="ts">
  import type { SceneState } from '$lib/types';
  import WidgetSlot from './WidgetSlot.svelte';
  import Clock from '$lib/widgets/Clock.svelte';
  import Weather from '$lib/widgets/Weather.svelte';
  import EntityTile from '$lib/widgets/EntityTile.svelte';
  import Background from '$lib/backgrounds/Background.svelte';

  export let scene: SceneState;

  const fontVar = (family: string) => `var(--cosmos-font-${family.replace(/\s+/g, '')}, system-ui, sans-serif)`;
</script>

<div
  class="scene-canvas"
  style="font-family: {fontVar(scene.typography.font_family)};
         --cosmos-font-scale: {scene.typography.font_scale};"
>
  <div class="background-layer" data-bg-type={scene.background.type}>
    <Background background={scene.background} />
  </div>
  <div
    class="widget-layer"
    style="grid-template-columns: repeat({scene.layout.cols}, 1fr);
           grid-template-rows: repeat({scene.layout.rows}, 1fr);
           padding: {scene.safeArea.top}px {scene.safeArea.right}px {scene.safeArea.bottom}px {scene.safeArea.left}px;"
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
    z-index: 1;
  }
</style>
