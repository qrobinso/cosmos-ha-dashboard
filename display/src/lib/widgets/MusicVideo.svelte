<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { WidgetState, MusicVideoData } from '$lib/types';

  export let widget: WidgetState;

  $: data = widget.data as MusicVideoData | null;
  $: videoId = data?.video_id ?? null;
  $: src = videoId ? `/api/musicvideo/stream/${videoId}` : null;

  // 0..1, default fully opaque. Lets the video sit under other widgets as a
  // subdued backdrop rather than competing with them for attention.
  $: opacityRaw = (widget.config as Record<string, unknown>).opacity;
  $: opacity =
    typeof opacityRaw === 'number' && Number.isFinite(opacityRaw)
      ? Math.min(1, Math.max(0, opacityRaw))
      : 1;

  let el: HTMLVideoElement | null = null;

  /**
   * `HTMLMediaElement.play()` only returns a Promise in modern browsers — some
   * Android WebViews (and jsdom) still return undefined, where `.catch()` would
   * throw a TypeError on every scene push. Autoplay rejections are expected and
   * ignored either way: the element is muted, so a block is a browser-policy
   * quirk we can do nothing about.
   */
  function safePlay(video: HTMLVideoElement) {
    try {
      const p = video.play() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Ignore — play() can throw synchronously on a detached element.
    }
  }

  // A load failure hides the widget rather than leaving the element's black
  // background as a permanent rectangle on the wall. Reset per video so a new
  // track always gets a fresh attempt.
  let failed = false;
  let lastAttemptedId: string | null = null;
  $: if (videoId !== lastAttemptedId) {
    lastAttemptedId = videoId;
    failed = false;
  }

  // Position sync. `position` is a snapshot, and crucially NOT one taken at
  // push time: many HA integrations (Chromecast, some DLNA) only refresh
  // `media_position` on seek/state-change, so a push triggered by an unrelated
  // entity carries a long-stale value. Anchoring to push-arrival time would
  // compute a position far behind reality and seek the video BACKWARD on every
  // push — an endless restart loop. HA gives us `media_position_updated_at`
  // for exactly this; fall back to arrival time only when it's absent.
  let anchorMs = Date.now();
  let pushedPosition: number | null = null;
  $: if (data) {
    const stamped = data.position_updated_at ? Date.parse(data.position_updated_at) : NaN;
    anchorMs = Number.isFinite(stamped) ? stamped : Date.now();
    pushedPosition = typeof data.position === 'number' ? data.position : null;
  }

  function livePosition(): number | null {
    if (pushedPosition === null) return null;
    if (data?.state !== 'playing') return pushedPosition;
    // Clamp: HA's clock and the kiosk's can disagree slightly, and a negative
    // elapsed would drag the position backward for no reason.
    const elapsedS = Math.max(0, (Date.now() - anchorMs) / 1000);
    return pushedPosition + elapsedS;
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
    if (el) safePlay(el);
  }

  // The proxy can 404 (expired or IP-bound stream url, upstream 403, a broken
  // yt-dlp extractor). Hide rather than show a black box forever.
  function onError() {
    failed = true;
  }

  // Re-check on each push (covers manual seeks on the media player).
  $: if (el && data) syncPosition();

  // Pause the video when the player pauses, so it doesn't run on alone.
  //
  // Guarded on the element's ACTUAL paused state rather than fired on every
  // push: an active media player re-pushes several times a second as
  // `media_position` ticks, and calling play() on an already-playing element
  // allocated a fresh promise each time for no effect. Only act on a real
  // transition.
  $: if (el) {
    const shouldPlay = data?.state === 'playing';
    if (shouldPlay && el.paused) safePlay(el);
    else if (!shouldPlay && !el.paused) el.pause();
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

{#if src && !failed}
  <!-- Muted always: audio belongs to the Home Assistant speaker, not the kiosk.
       `muted` is also what lets autoplay work without user interaction. -->
  <!-- disablepictureinpicture / disableremoteplayback: this is decorative wall
       ambience, so there is no reason to keep the Cast and PiP machinery (and
       their hover controls) alive on a kiosk that can never use them.
       x-webkit-airplay does the same on Safari/iOS panels. -->
  <video
    bind:this={el}
    {src}
    class="mv"
    style="opacity: {opacity}"
    muted
    playsinline
    loop
    autoplay
    preload="auto"
    disablepictureinpicture
    disableremoteplayback
    x-webkit-airplay="deny"
    on:loadedmetadata={onLoadedMetadata}
    on:error={onError}
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
