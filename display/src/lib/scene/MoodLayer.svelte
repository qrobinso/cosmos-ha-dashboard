<script lang="ts">
  import type { ResolvedMood } from '$lib/types';
  import { onMount } from 'svelte';

  export let mood: ResolvedMood;

  let videoA: HTMLVideoElement;
  let videoB: HTMLVideoElement;
  let opA = 1;
  let opB = 0;
  let bOffsetApplied = false;
  let reduce = false;

  /** Triangle wave: 0 at the seam (phase 0 / 1), peaks at 1 at phase 0.5. */
  function tri(phase: number): number {
    const p = ((phase % 1) + 1) % 1;
    return Math.max(0, 1 - 2 * Math.abs(p - 0.5));
  }

  function recompute() {
    if (!videoA || !videoB) return;
    if (reduce) {
      opA = 1;
      opB = 0;
      return;
    }
    const d = videoA.duration;
    if (!Number.isFinite(d) || d <= 0) {
      opA = 1;
      opB = 0;
      return;
    }
    if (!bOffsetApplied) {
      try {
        videoB.currentTime = d / 2;
        bOffsetApplied = true;
      } catch {
        /* seek may throw before metadata is fully ready */
      }
    }
    opA = tri(videoA.currentTime / d);
    opB = tri(videoB.currentTime / d);
  }

  onMount(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    if (reduce) {
      videoA?.pause();
      videoB?.pause();
      opA = 1;
      opB = 0;
    }
  });
</script>

<video
  class="mood-video"
  bind:this={videoA}
  src={mood.url}
  autoplay={!reduce}
  loop
  muted
  playsinline
  preload="auto"
  on:loadedmetadata={recompute}
  on:timeupdate={recompute}
  style="--mood-blend: {mood.blend}; opacity: {opA};"
/>
<video
  class="mood-video"
  bind:this={videoB}
  src={mood.url}
  autoplay={!reduce}
  loop
  muted
  playsinline
  preload="auto"
  on:loadedmetadata={recompute}
  on:timeupdate={recompute}
  style="--mood-blend: {mood.blend}; opacity: {opB};"
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
