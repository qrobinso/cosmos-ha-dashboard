<script lang="ts">
  import type { ResolvedMood } from '$lib/types';
  import { onMount } from 'svelte';

  export let mood: ResolvedMood;

  let videoEl: HTMLVideoElement;
  let reduce = false;

  onMount(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    if (reduce && videoEl) {
      videoEl.pause();
    }
  });
</script>

<video
  class="mood-video"
  bind:this={videoEl}
  src={mood.url}
  autoplay={!reduce}
  loop
  muted
  playsinline
  preload="auto"
  style="--mood-blend: {mood.blend};"
/>

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
  }
</style>
