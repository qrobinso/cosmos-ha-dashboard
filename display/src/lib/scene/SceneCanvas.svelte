<script lang="ts">
  import type { SceneState } from '$lib/types';
  import WidgetSlot from './WidgetSlot.svelte';

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
      <WidgetSlot {widget}>
        <slot name="widget" {widget} />
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
