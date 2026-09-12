<script lang="ts">
  import type { ResolvedMood } from '$lib/types';
  import { onMount } from 'svelte';
  import Aerials from './Aerials.svelte';

  export let mood: ResolvedMood;
  /** Crossfade length for aerial clip changes. */
  export let fadeMs = 800;

  let videoEl: HTMLVideoElement;
  let reduce = false;

  $: layerOpacity = Math.max(0, Math.min(1, mood.opacity ?? 1));

  onMount(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    if (reduce && videoEl) {
      videoEl.pause();
    }
  });
</script>

{#if mood.kind === 'aerials'}
  <!-- Aerials are real footage, so they sit over the background opaque
       (blend: normal) and only opacity lets the gradient show through. -->
  <div class="mood-aerials" style="opacity: {layerOpacity};">
    <Aerials clips={mood.clips} shuffle={mood.shuffle} intervalMin={mood.interval_min} {fadeMs} />
  </div>
{:else}
  <video
    class="mood-video"
    bind:this={videoEl}
    src={mood.url}
    autoplay={!reduce}
    loop
    muted
    playsinline
    preload="metadata"
    disableremoteplayback
    style="--mood-blend: {mood.blend}; opacity: {layerOpacity};"
  />
{/if}

<style>
  .mood-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    z-index: 1;
    mix-blend-mode: var(--mood-blend, screen);
    will-change: opacity;
    transition: opacity 0.3s ease;
  }
  .mood-aerials {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
    transition: opacity 0.3s ease;
  }
</style>
