<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { WidgetState, CameraData } from '$lib/types';

  export let widget: WidgetState;

  $: cam = widget.data as CameraData | null;
  $: cfg = widget.config as Record<string, unknown>;
  $: view = (typeof cfg.view === 'string' ? cfg.view : 'auto') as 'auto' | 'live';
  $: fit = (typeof cfg.fit === 'string' ? cfg.fit : 'cover') as 'cover' | 'contain' | 'fill';
  $: aspectRatio = typeof cfg.aspect_ratio === 'string' && cfg.aspect_ratio
    ? cfg.aspect_ratio.replace(':', ' / ')
    : '';
  $: refreshSec = (() => {
    const v = cfg.refresh_interval_s;
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? v : 10;
  })();
  $: showName = cfg.show_name === true;
  $: showState = cfg.show_state === true;
  $: nameOverride = typeof cfg.name === 'string' ? cfg.name : '';
  $: displayName = nameOverride || cam?.friendly_name || '';

  // Cache-busting tick for snapshot polling. The url itself is stable so we
  // append `?t=<ms>` and bump the value to force the browser to refetch.
  let tick = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;

  function clearTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  $: {
    // Re-arm the polling timer whenever view/refresh changes.
    clearTimer();
    if (cam?.available && view === 'auto' && refreshSec > 0) {
      timer = setInterval(() => {
        tick = Date.now();
      }, refreshSec * 1000);
    }
  }

  onDestroy(clearTimer);

  $: imgSrc = (() => {
    if (!cam || !cam.snapshot_url) return '';
    if (view === 'live') return cam.stream_url;
    return `${cam.snapshot_url}?t=${tick}`;
  })();
</script>

<div class="camera" class:has-aspect={!!aspectRatio} style={aspectRatio ? `aspect-ratio: ${aspectRatio};` : ''}>
  {#if !cam || !cam.available}
    <div class="placeholder">
      <span class="dot"></span>
      <span class="msg">{cam ? cam.friendly_name : 'Camera'} unavailable</span>
    </div>
  {:else}
    <img class="feed" style="object-fit: {fit};" src={imgSrc} alt={displayName || cam.entity_id} />
    {#if showName && displayName}
      <div class="overlay name">{displayName}</div>
    {/if}
    {#if showState}
      <div class="overlay state" data-state={cam.state}>{cam.state}</div>
    {/if}
  {/if}
</div>

<style>
  .camera {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: var(--cosmos-widget-radius, 0.75rem);
    background: #000;
  }
  .camera.has-aspect {
    height: auto;
    max-height: 100%;
    margin: auto;
  }
  .feed {
    width: 100%;
    height: 100%;
    display: block;
  }
  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.9rem;
    background: rgba(255, 255, 255, 0.04);
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: rgba(255, 120, 120, 0.7);
  }
  .overlay {
    position: absolute;
    padding: 0.25rem 0.55rem;
    border-radius: 0.4rem;
    background: rgba(0, 0, 0, 0.55);
    color: #f5f5f5;
    font-size: 0.8rem;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .overlay.name {
    top: 0.5rem;
    left: 0.5rem;
  }
  .overlay.state {
    top: 0.5rem;
    right: 0.5rem;
    text-transform: capitalize;
    letter-spacing: 0.02em;
  }
  .overlay.state[data-state='recording'],
  .overlay.state[data-state='streaming'] {
    background: rgba(220, 60, 60, 0.7);
  }
</style>
