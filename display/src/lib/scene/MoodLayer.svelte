<script lang="ts">
  import type { ResolvedMood } from '$lib/types';
  import { onMount } from 'svelte';

  export let mood: ResolvedMood;

  /** Seconds at each end of the clip during which we fade to hide the loop seam. */
  const FADE_S = 0.5;

  let videoEl: HTMLVideoElement;
  let reduce = false;
  let opacity = 1;

  function recompute() {
    if (!videoEl || reduce) {
      opacity = 1;
      return;
    }
    const t = videoEl.currentTime;
    const d = videoEl.duration;
    if (!Number.isFinite(d) || d <= FADE_S * 2) {
      opacity = 1;
      return;
    }
    const fadeIn = Math.min(1, t / FADE_S);
    const fadeOut = Math.min(1, (d - t) / FADE_S);
    opacity = Math.max(0, Math.min(fadeIn, fadeOut));
  }

  onMount(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    if (reduce && videoEl) videoEl.pause();
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
  on:timeupdate={recompute}
  on:loadedmetadata={recompute}
  style="--mood-blend: {mood.blend}; opacity: {opacity};"
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
