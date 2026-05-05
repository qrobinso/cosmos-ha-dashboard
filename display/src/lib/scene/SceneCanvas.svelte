<script lang="ts">
  import type { SceneState } from '$lib/types';
  import WidgetSlot from './WidgetSlot.svelte';
  import Clock from '$lib/widgets/Clock.svelte';
  import Weather from '$lib/widgets/Weather.svelte';
  import EntityTile from '$lib/widgets/EntityTile.svelte';
  import Calendar from '$lib/widgets/Calendar.svelte';
  import MediaPlayer from '$lib/widgets/MediaPlayer.svelte';
  import Statistics from '$lib/widgets/Statistics.svelte';
  import Background from '$lib/backgrounds/Background.svelte';
  import MoodLayer from './MoodLayer.svelte';

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
  {#if scene.resolvedMood}
    {#key scene.id}
      <MoodLayer mood={scene.resolvedMood} />
    {/key}
  {/if}
  <div
    class="widget-layer"
    class:floating={scene.floatWidgets}
    style="grid-template-columns: repeat({scene.layout.cols}, 1fr);
           grid-template-rows: repeat({scene.layout.rows}, 1fr);
           padding: {scene.safeArea.top}px {scene.safeArea.right}px {scene.safeArea.bottom}px {scene.safeArea.left}px;"
  >
    {#each scene.widgets as widget, i (widget.id)}
      <WidgetSlot {widget} floatDelay={(i * 1.37) % 6.5} let:widget={w}>
        {#if w.kind === 'clock'}
          <Clock widget={w} />
        {:else if w.kind === 'weather'}
          <Weather widget={w} />
        {:else if w.kind === 'entity_tile'}
          <EntityTile widget={w} />
        {:else if w.kind === 'calendar'}
          <Calendar widget={w} />
        {:else if w.kind === 'media_player'}
          <MediaPlayer widget={w} />
        {:else if w.kind === 'statistics'}
          <Statistics widget={w} />
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
    isolation: isolate;
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
    z-index: 2;
  }
  @keyframes cosmos-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }
  @media (prefers-reduced-motion: no-preference) {
    .widget-layer.floating :global(.widget-slot) {
      animation: cosmos-float 6.5s ease-in-out infinite;
      animation-delay: var(--cosmos-float-delay, 0s);
      will-change: transform;
    }
  }
</style>
