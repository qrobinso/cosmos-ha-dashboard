<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { WidgetState, MusicVideoData } from '$lib/types';

  export let widget: WidgetState;

  $: data = widget.data as MusicVideoData | null;
  $: videoId = data?.video_id ?? null;
  $: src = videoId ? `/api/musicvideo/stream/${videoId}` : null;

  let el: HTMLVideoElement | null = null;

  // Position sync. The server's `position` is a snapshot from push time, so
  // advance it by the wall-clock delta since we received it — the same
  // approach MediaPlayer.svelte uses for its progress bar.
  let receivedAtMs = Date.now();
  let pushedPosition: number | null = null;
  $: if (data) {
    receivedAtMs = Date.now();
    pushedPosition = typeof data.position === 'number' ? data.position : null;
  }

  function livePosition(): number | null {
    if (pushedPosition === null) return null;
    if (data?.state !== 'playing') return pushedPosition;
    return pushedPosition + (Date.now() - receivedAtMs) / 1000;
  }

  /** Only correct real divergence — chasing sub-second drift every tick would
   *  stutter the video for no visible gain. */
  const DRIFT_TOLERANCE_S = 3;

  function syncPosition() {
    if (!el) return;
    const target = livePosition();
    if (target === null || !Number.isFinite(target)) return;
    // The video and the track are rarely the same length; wrap so a long song
    // over a short video still lands somewhere sensible rather than past the end.
    const dur = el.duration;
    const seekTo = Number.isFinite(dur) && dur > 0 ? target % dur : target;
    if (Math.abs(el.currentTime - seekTo) > DRIFT_TOLERANCE_S) {
      el.currentTime = seekTo;
    }
  }

  // A new videoId means a new <video> load; seek once metadata is available.
  function onLoadedMetadata() {
    syncPosition();
    void el?.play().catch(() => {});
  }

  // Re-check on each push (covers manual seeks on the media player).
  $: if (el && data) syncPosition();

  // Pause the video when the player pauses, so it doesn't run on alone.
  $: if (el) {
    if (data?.state === 'playing') void el.play().catch(() => {});
    else el.pause();
  }

  onDestroy(() => {
    // Drop the connection to the proxy promptly rather than waiting for GC.
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  });
</script>

{#if src}
  <!-- Muted always: audio belongs to the Home Assistant speaker, not the kiosk.
       `muted` is also what lets autoplay work without user interaction. -->
  <video
    bind:this={el}
    {src}
    class="mv"
    muted
    playsinline
    loop
    autoplay
    on:loadedmetadata={onLoadedMetadata}
  ></video>
{/if}

<style>
  .mv {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: inherit;
    background: #000;
  }
</style>
