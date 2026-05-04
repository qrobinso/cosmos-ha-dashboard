<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { WidgetState, MediaPlayerData } from '$lib/types';

  export let widget: WidgetState;

  $: data = widget.data as MediaPlayerData | null;
  $: cfg = widget.config as Record<string, unknown>;

  $: showAlbumArt = cfg.show_album_art !== false;
  $: showArtist = cfg.show_artist !== false;
  $: showAlbum = cfg.show_album === true;
  $: showProgress = cfg.show_progress !== false;
  $: showControls = cfg.show_controls !== false;
  $: showVolume = cfg.show_volume === true;
  $: showSource = cfg.show_source === true;
  $: blurBackground = cfg.blur_background !== false;
  $: compact = cfg.compact === true;

  // Local clock-driven progress so the bar inches forward between server pushes.
  let nowMs = Date.now();
  let timer: ReturnType<typeof setInterval>;
  onMount(() => {
    timer = setInterval(() => (nowMs = Date.now()), 1000);
  });
  onDestroy(() => clearInterval(timer));

  // The server-pushed `position` is a snapshot; advance it client-side while playing.
  let receivedAtMs = Date.now();
  let lastPosition: number | null = null;
  $: if (data) {
    receivedAtMs = Date.now();
    lastPosition = data.position ?? null;
  }
  $: livePosition = (() => {
    if (lastPosition === null) return null;
    if (data?.state !== 'playing') return lastPosition;
    return Math.min((data.duration ?? Infinity), lastPosition + (nowMs - receivedAtMs) / 1000);
  })();

  function fmtTime(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–:––';
    const total = Math.max(0, Math.floor(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  $: progressPct = livePosition !== null && data?.duration
    ? Math.min(100, Math.max(0, (livePosition / data.duration) * 100))
    : 0;

  $: stateLabel = data
    ? data.state === 'playing' ? 'Playing'
      : data.state === 'paused' ? 'Paused'
      : data.state === 'idle' ? 'Idle'
      : data.state === 'off' ? 'Off'
      : data.state.charAt(0).toUpperCase() + data.state.slice(1)
    : 'Unknown';
</script>

<div class="media" class:compact data-state={data?.state ?? 'unknown'}>
  {#if blurBackground && data?.album_art_url}
    <div class="bg" style="background-image:url({data.album_art_url})"></div>
  {/if}

  <div class="content">
    {#if showAlbumArt}
      {#if data?.album_art_url}
        <img class="art" src={data.album_art_url} alt={data.album ?? ''} />
      {:else}
        <div class="art placeholder" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="9"></circle>
            <circle cx="12" cy="12" r="3.2"></circle>
          </svg>
        </div>
      {/if}
    {/if}

    <div class="info">
      <div class="line title">{data?.title ?? '—'}</div>
      {#if showArtist && data?.artist}
        <div class="line artist">{data.artist}</div>
      {/if}
      {#if showAlbum && data?.album}
        <div class="line album">{data.album}</div>
      {/if}

      {#if showProgress && (data?.duration ?? 0) > 0}
        <div class="progress">
          <div class="bar"><div class="fill" style="width: {progressPct}%"></div></div>
          <div class="times">
            <span>{fmtTime(livePosition)}</span>
            <span>{fmtTime(data?.duration)}</span>
          </div>
        </div>
      {/if}

      {#if showControls}
        <div class="controls" aria-label="Playback">
          {#if data?.supports?.previous !== false}
            <button class="ctl" type="button" aria-label="Previous">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6v12M19 6L9 12l10 6V6z"/></svg>
            </button>
          {/if}
          <button class="ctl primary" type="button" aria-label={data?.state === 'playing' ? 'Pause' : 'Play'}>
            {#if data?.state === 'playing'}
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
            {:else}
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7V5z"/></svg>
            {/if}
          </button>
          {#if data?.supports?.next !== false}
            <button class="ctl" type="button" aria-label="Next">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 6v12M5 6l10 6-10 6V6z"/></svg>
            </button>
          {/if}
        </div>
      {/if}

      {#if showVolume && typeof data?.volume === 'number'}
        <div class="volume" aria-label="Volume">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 10v4h3l5 4V6L6 10H3z"/>
            {#if !data.muted}<path d="M16 8a5 5 0 0 1 0 8"/>{/if}
          </svg>
          <div class="vol-bar"><div class="vol-fill" style="width: {data.muted ? 0 : (data.volume * 100)}%"></div></div>
        </div>
      {/if}

      {#if showSource && (data?.source || data?.app)}
        <div class="source">{data?.app ?? data?.source}</div>
      {/if}

      {#if !data || data.state === 'idle' || data.state === 'off'}
        <div class="state">{stateLabel}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .media {
    --pad: 1rem;
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    border-radius: 0.75rem;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.04);
    box-sizing: border-box;
    color: inherit;
  }
  .media .bg {
    position: absolute;
    inset: -2rem;
    background-size: cover;
    background-position: center;
    filter: blur(36px) brightness(0.55) saturate(1.2);
    z-index: 0;
    transform: scale(1.15);
  }
  .content {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--pad);
    width: 100%;
    height: 100%;
    padding: var(--pad);
    box-sizing: border-box;
  }
  .art {
    width: 4.5rem;
    aspect-ratio: 1;
    border-radius: 0.5rem;
    object-fit: cover;
    flex-shrink: 0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  }
  .art.placeholder {
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.4);
  }
  .art.placeholder svg { width: 60%; height: 60%; }
  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    font-size: calc(1.05rem * var(--cosmos-font-scale, 1));
    font-weight: 500;
    letter-spacing: -0.01em;
  }
  .artist {
    font-size: calc(0.88rem * var(--cosmos-font-scale, 1));
    opacity: 0.78;
  }
  .album {
    font-size: calc(0.78rem * var(--cosmos-font-scale, 1));
    opacity: 0.55;
  }
  .progress {
    margin-top: 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .bar {
    height: 3px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 999px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: currentColor;
    opacity: 0.85;
    transition: width 1s linear;
  }
  .times {
    display: flex;
    justify-content: space-between;
    font-size: calc(0.7rem * var(--cosmos-font-scale, 1));
    font-variant-numeric: tabular-nums;
    opacity: 0.65;
  }
  .controls {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.5rem;
  }
  .ctl {
    width: 2rem;
    height: 2rem;
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    color: inherit;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .ctl svg { width: 1rem; height: 1rem; }
  .ctl.primary { width: 2.4rem; height: 2.4rem; background: rgba(255, 255, 255, 0.85); color: #000; }
  .ctl.primary svg { width: 1.1rem; height: 1.1rem; }
  .volume {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.45rem;
    font-size: 0.8rem;
    opacity: 0.7;
  }
  .volume svg { width: 0.95rem; height: 0.95rem; }
  .vol-bar { flex: 1; height: 2px; background: rgba(255, 255, 255, 0.15); border-radius: 999px; overflow: hidden; }
  .vol-fill { height: 100%; background: currentColor; opacity: 0.85; }
  .source {
    margin-top: 0.45rem;
    font-size: calc(0.7rem * var(--cosmos-font-scale, 1));
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.55;
  }
  .state {
    font-size: calc(0.85rem * var(--cosmos-font-scale, 1));
    opacity: 0.55;
  }

  .media.compact .content { padding: 0.6rem 0.85rem; gap: 0.7rem; }
  .media.compact .art { width: 2.75rem; }
  .media.compact .controls { margin-top: 0.25rem; }
  .media.compact .progress { margin-top: 0.25rem; }
</style>
