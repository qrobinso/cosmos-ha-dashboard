<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { WidgetState, MediaPlayerData } from '$lib/types';
  import { marquee } from '$lib/actions/marquee';

  export let widget: WidgetState;

  $: data = widget.data as MediaPlayerData | null;
  $: cfg = widget.config as Record<string, unknown>;

  const THEMES = ['default', 'cinematic', 'card', 'vinyl'] as const;
  type Theme = (typeof THEMES)[number];
  $: theme = (THEMES.includes(cfg.theme as Theme) ? cfg.theme : 'default') as Theme;

  $: showAlbumArt = cfg.show_album_art !== false;
  $: showTitle = cfg.show_title !== false;
  $: showArtist = cfg.show_artist !== false;
  $: showAlbum = cfg.show_album === true;
  $: showProgress = cfg.show_progress !== false;
  $: showControls = cfg.show_controls !== false;
  $: showVolume = cfg.show_volume === true;
  $: showSource = cfg.show_source === true;
  $: blurBackground = cfg.blur_background !== false;
  $: compact = cfg.compact === true;
  $: transparent = cfg.transparent === true;

  // Local clock-driven progress so the bar inches forward between server pushes.
  let nowMs = Date.now();
  let timer: ReturnType<typeof setInterval>;
  onMount(() => {
    timer = setInterval(() => (nowMs = Date.now()), 1000);
  });
  onDestroy(() => clearInterval(timer));

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

  // "No music playing" covers: no data at all, source off/idle/unknown, or
  // an active state with no track metadata (some integrations report 'on'
  // with empty title when nothing is queued).
  $: idleStates = new Set(['idle', 'off', 'standby', 'unknown', 'unavailable', 'none']);
  $: noMusic = !data || idleStates.has(data.state) || !(data.title && data.title.trim());
  const NO_MUSIC_LABEL = 'No music playing';
</script>

<div class="media" class:compact class:transparent data-theme={theme} data-state={data?.state ?? 'unknown'}>
  {#if blurBackground && data?.album_art_url && !noMusic}
    <div class="bg" style="background-image:url({data.album_art_url})"></div>
  {/if}

  {#if noMusic}
    <div class="no-music" aria-label={NO_MUSIC_LABEL}>
      <svg class="no-music-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
      </svg>
      <div class="no-music-label">{NO_MUSIC_LABEL}</div>
    </div>
  {:else if theme === 'default'}
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
        {#if showTitle}
          <div class="line title" use:marquee><span>{data?.title ?? '—'}</span></div>
        {/if}
        {#if showArtist && data?.artist}<div class="line artist" use:marquee><span>{data.artist}</span></div>{/if}
        {#if showAlbum && data?.album}<div class="line album" use:marquee><span>{data.album}</span></div>{/if}
        {#if showProgress && (data?.duration ?? 0) > 0}
          <div class="progress">
            <div class="bar"><div class="fill" style="width: {progressPct}%"></div></div>
            <div class="times"><span>{fmtTime(livePosition)}</span><span>{fmtTime(data?.duration)}</span></div>
          </div>
        {/if}
        {#if showControls}
          <div class="controls" aria-label="Playback">
            {#if data?.supports?.previous !== false}
              <button class="ctl" type="button" aria-label="Previous"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6v12M19 6L9 12l10 6V6z"/></svg></button>
            {/if}
            <button class="ctl primary" type="button" aria-label={data?.state === 'playing' ? 'Pause' : 'Play'}>
              {#if data?.state === 'playing'}
                <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7V5z"/></svg>
              {/if}
            </button>
            {#if data?.supports?.next !== false}
              <button class="ctl" type="button" aria-label="Next"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 6v12M5 6l10 6-10 6V6z"/></svg></button>
            {/if}
          </div>
        {/if}
        {#if showVolume && typeof data?.volume === 'number'}
          <div class="volume" aria-label="Volume">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 10v4h3l5 4V6L6 10H3z"/>{#if !data.muted}<path d="M16 8a5 5 0 0 1 0 8"/>{/if}</svg>
            <div class="vol-bar"><div class="vol-fill" style="width: {data.muted ? 0 : (data.volume * 100)}%"></div></div>
          </div>
        {/if}
        {#if showSource && (data?.source || data?.app)}<div class="source">{data?.app ?? data?.source}</div>{/if}
        {#if !data || data.state === 'idle' || data.state === 'off'}<div class="state">{stateLabel}</div>{/if}
      </div>
    </div>

  {:else if theme === 'cinematic'}
    <div class="cine">
      {#if showAlbumArt}
        {#if data?.album_art_url}
          <img class="cine-art" src={data.album_art_url} alt={data.album ?? ''} />
        {:else}
          <div class="cine-art placeholder"></div>
        {/if}
      {/if}
      <div class="cine-overlay"></div>
      <div class="cine-eyebrow">Listening to</div>
      <!-- Headline under "LISTENING TO" — track title when shown,
           falls back to album when title is hidden. -->
      {#if showTitle}
        <div class="cine-headline" use:marquee><span>{data?.title ?? '—'}</span></div>
      {:else if showAlbum && data?.album}
        <div class="cine-headline" use:marquee><span>{data.album}</span></div>
      {/if}
      {#if showArtist && data?.artist}
        <div class="cine-artist" use:marquee><span>{data.artist}</span></div>
      {/if}
      {#if showTitle && showAlbum && data?.album}
        <div class="cine-album" use:marquee><span>{data.album}</span></div>
      {/if}
      {#if showProgress && (data?.duration ?? 0) > 0}
        <div class="cine-progress"><div class="bar"><div class="fill" style="width:{progressPct}%"></div></div></div>
      {/if}
    </div>

  {:else if theme === 'card'}
    <div class="card-layout">
      <div class="card-eyebrow">Now Playing</div>
      {#if showAlbum && data?.album}
        <div class="card-title" use:marquee><span>{data.album}</span></div>
      {/if}
      {#if showAlbumArt}
        {#if data?.album_art_url}
          <img class="card-art" src={data.album_art_url} alt="" />
        {:else}
          <div class="card-art placeholder"></div>
        {/if}
      {/if}
      <div class="card-info">
        {#if showTitle}
          <div class="card-track" use:marquee><span>{data?.title ?? '—'}</span></div>
        {/if}
        {#if showArtist && data?.artist}<div class="card-artist" use:marquee><span>{data.artist}</span></div>{/if}
      </div>
      {#if showProgress && (data?.duration ?? 0) > 0}
        <div class="card-progress">
          <div class="bar"><div class="fill" style="width:{progressPct}%"></div></div>
          <div class="times"><span>{fmtTime(livePosition)}</span><span>{fmtTime(data?.duration)}</span></div>
        </div>
      {/if}
      {#if showControls}
        <div class="card-controls">
          <button class="ctl" type="button" aria-label="Previous"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6v12M19 6L9 12l10 6V6z"/></svg></button>
          <button class="ctl primary" type="button" aria-label={data?.state === 'playing' ? 'Pause' : 'Play'}>
            {#if data?.state === 'playing'}
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
            {:else}
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7V5z"/></svg>
            {/if}
          </button>
          <button class="ctl" type="button" aria-label="Next"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 6v12M5 6l10 6-10 6V6z"/></svg></button>
        </div>
      {/if}
    </div>

  {:else if theme === 'vinyl'}
    <div class="vinyl-layout">
      <div class="vinyl-stage">
        {#if showAlbumArt}
          {#if data?.album_art_url}
            <img class="vinyl-art" src={data.album_art_url} alt="" />
          {:else}
            <div class="vinyl-art placeholder"></div>
          {/if}
        {/if}
        <div class="vinyl-disc" class:spinning={data?.state === 'playing'} aria-hidden="true">
          <div class="vinyl-disc-grooves"></div>
          {#if showAlbumArt && data?.album_art_url}
            <div class="vinyl-disc-label" style="background-image:url({data.album_art_url})"></div>
          {:else}
            <div class="vinyl-disc-label"></div>
          {/if}
          <div class="vinyl-disc-hole"></div>
        </div>
      </div>
      <div class="vinyl-meta">
        {#if showTitle}
          <div class="vinyl-title" use:marquee><span>{data?.title ?? '—'}</span></div>
        {/if}
        {#if showArtist && data?.artist}<div class="vinyl-artist" use:marquee><span>{data.artist}</span></div>{/if}
        {#if showAlbum && data?.album}<div class="vinyl-album" use:marquee><span>{data.album}</span></div>{/if}
        {#if showProgress && (data?.duration ?? 0) > 0}
          <div class="vinyl-progress"><div class="bar"><div class="fill" style="width:{progressPct}%"></div></div></div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .media {
    --pad: 1rem;
    --cosmos-edge-fade: 0.6rem;
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    border-radius: var(--cosmos-widget-radius, 1.25rem);
    overflow: hidden;
    background: rgba(255, 255, 255, 0.04);
    box-sizing: border-box;
    color: inherit;
    -webkit-mask-image:
      linear-gradient(to right, transparent 0, black var(--cosmos-edge-fade), black calc(100% - var(--cosmos-edge-fade)), transparent 100%),
      linear-gradient(to bottom, transparent 0, black var(--cosmos-edge-fade), black calc(100% - var(--cosmos-edge-fade)), transparent 100%);
    mask-image:
      linear-gradient(to right, transparent 0, black var(--cosmos-edge-fade), black calc(100% - var(--cosmos-edge-fade)), transparent 100%),
      linear-gradient(to bottom, transparent 0, black var(--cosmos-edge-fade), black calc(100% - var(--cosmos-edge-fade)), transparent 100%);
    -webkit-mask-composite: source-in;
    mask-composite: intersect;
  }
  .no-music {
    position: relative;
    z-index: 1;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 1rem;
    box-sizing: border-box;
    color: inherit;
    opacity: 0.7;
    text-align: center;
  }
  .no-music-icon {
    width: calc(min(22cqmin, 30cqh) * var(--cosmos-font-scale, 1));
    height: auto;
    max-width: 40%;
    max-height: 40%;
    opacity: 0.7;
  }
  .no-music-label {
    font-size: calc(min(8cqmin, 12cqh) * var(--cosmos-font-scale, 1));
    font-weight: 500;
    letter-spacing: 0.02em;
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

  /* ---------------- shared ---------------- */
  .placeholder { background: rgba(255, 255, 255, 0.06); display: grid; place-items: center; }
  .bar { height: 3px; background: rgba(255, 255, 255, 0.15); border-radius: 999px; overflow: hidden; }
  .fill { height: 100%; background: currentColor; opacity: 0.85; transition: width 1s linear; }
  .times { display: flex; justify-content: space-between; font-size: calc(0.7rem * var(--cosmos-font-scale, 1)); font-variant-numeric: tabular-nums; opacity: 0.65; }
  .ctl {
    width: 2rem; height: 2rem; border: 0; border-radius: 999px;
    background: rgba(255, 255, 255, 0.08); color: inherit;
    display: grid; place-items: center; cursor: pointer;
  }
  .ctl svg { width: 1rem; height: 1rem; }
  .ctl.primary { width: 2.4rem; height: 2.4rem; background: rgba(255, 255, 255, 0.85); color: #000; }
  .ctl.primary svg { width: 1.1rem; height: 1.1rem; }

  /* ---------------- default theme ---------------- */
  .media[data-theme='default'] .content {
    position: relative; z-index: 1;
    display: flex; align-items: center; gap: var(--pad);
    width: 100%; height: 100%; padding: var(--pad); box-sizing: border-box;
  }
  .media[data-theme='default'] .art { width: 4.5rem; aspect-ratio: 1; border-radius: 0.5rem; object-fit: cover; flex-shrink: 0; box-shadow: 0 4px 16px rgba(0,0,0,0.45); }
  .media[data-theme='default'] .art.placeholder { color: rgba(255,255,255,0.4); }
  .media[data-theme='default'] .art.placeholder svg { width: 60%; height: 60%; }
  .media[data-theme='default'] .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.2rem; }
  .media[data-theme='default'] .line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .media[data-theme='default'] .title { font-size: calc(1.05rem * var(--cosmos-font-scale, 1)); font-weight: 500; letter-spacing: -0.01em; }
  .media[data-theme='default'] .artist { font-size: calc(0.88rem * var(--cosmos-font-scale, 1)); opacity: 0.78; }
  .media[data-theme='default'] .album { font-size: calc(0.78rem * var(--cosmos-font-scale, 1)); opacity: 0.55; }
  .media[data-theme='default'] .progress { margin-top: 0.45rem; display: flex; flex-direction: column; gap: 0.25rem; }
  .media[data-theme='default'] .controls { display: inline-flex; align-items: center; gap: 0.45rem; margin-top: 0.5rem; }
  .media[data-theme='default'] .volume { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.45rem; font-size: calc(0.8rem * var(--cosmos-font-scale, 1)); opacity: 0.7; }
  .media[data-theme='default'] .volume svg { width: 0.95rem; height: 0.95rem; }
  .media[data-theme='default'] .vol-bar { flex: 1; height: 2px; background: rgba(255,255,255,0.15); border-radius: 999px; overflow: hidden; }
  .media[data-theme='default'] .vol-fill { height: 100%; background: currentColor; opacity: 0.85; }
  .media[data-theme='default'] .source { margin-top: 0.45rem; font-size: calc(0.7rem * var(--cosmos-font-scale, 1)); text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.55; }
  .media[data-theme='default'] .state { font-size: calc(0.85rem * var(--cosmos-font-scale, 1)); opacity: 0.55; }
  .media[data-theme='default'].compact .content { padding: 0.6rem 0.85rem; gap: 0.7rem; }
  .media[data-theme='default'].compact .art { width: 2.75rem; }
  .media[data-theme='default'].compact .controls { margin-top: 0.25rem; }
  .media[data-theme='default'].compact .progress { margin-top: 0.25rem; }

  /* ---------------- cinematic theme (image 1) ---------------- */
  .media[data-theme='cinematic'] { background: #1a0606; }
  .media[data-theme='cinematic'] .cine { position: relative; z-index: 1; width: 100%; height: 100%; }
  .media[data-theme='cinematic'] .cine-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .media[data-theme='cinematic'] .cine-overlay {
    position: absolute; inset: 0;
    background:
      linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.75) 100%),
      radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%);
  }
  .media[data-theme='cinematic'] .cine-eyebrow {
    position: absolute; top: 8%; left: 8%; right: 8%;
    font-size: calc(min(7cqmin, 11cqh) * var(--cosmos-font-scale, 1));
    letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.85;
    font-weight: 500;
  }
  /* Headline under "LISTENING TO" — large, bold, top-left. */
  .media[data-theme='cinematic'] .cine-headline {
    position: absolute; top: calc(8% + 1.4em); left: 8%; right: 8%;
    font-size: calc(min(13cqmin, 18cqh) * var(--cosmos-font-scale, 1));
    font-weight: 700; letter-spacing: -0.01em; line-height: 1.05;
  }
  /* Artist anchored bottom-left, full width minus margins (no waveform on right). */
  .media[data-theme='cinematic'] .cine-artist {
    position: absolute; bottom: 8%; left: 8%; right: 8%;
    font-size: calc(min(8cqmin, 12cqh) * var(--cosmos-font-scale, 1));
    font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  }
  /* Optional secondary album line, smaller, sits below artist. */
  .media[data-theme='cinematic'] .cine-album {
    position: absolute; bottom: calc(8% - 1.4em); left: 8%; right: 8%;
    font-size: calc(min(6cqmin, 9cqh) * var(--cosmos-font-scale, 1));
    letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.65;
  }
  .media[data-theme='cinematic'] .cine-progress { position: absolute; left: 0; right: 0; bottom: 0; padding: 0; }
  .media[data-theme='cinematic'] .cine-progress .bar { height: 2px; border-radius: 0; background: rgba(255,255,255,0.18); }

  /* ---------------- card theme (image 2) ---------------- */
  .media[data-theme='card'] {
    background: linear-gradient(160deg, #4a2870 0%, #6b3e9c 60%, #9a5fc8 100%);
  }
  .media[data-theme='card'] .card-layout {
    position: relative; z-index: 1;
    display: grid; grid-template-rows: auto auto 1fr auto auto auto;
    width: 100%; height: 100%; padding: 6% 7%; gap: 3%;
    box-sizing: border-box;
  }
  .media[data-theme='card'] .card-eyebrow {
    font-size: calc(min(5cqmin, 8cqh) * var(--cosmos-font-scale, 1));
    letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.75;
    font-weight: 500;
  }
  .media[data-theme='card'] .card-title {
    font-size: calc(min(11cqmin, 15cqh) * var(--cosmos-font-scale, 1));
    font-weight: 800; letter-spacing: -0.01em; line-height: 1;
    text-transform: uppercase;
  }
  .media[data-theme='card'] .card-art {
    width: 100%; height: 100%; min-height: 0;
    object-fit: cover; border-radius: 0.6rem;
    box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  }
  .media[data-theme='card'] .card-art.placeholder { background: rgba(255,255,255,0.08); }
  .media[data-theme='card'] .card-info { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
  .media[data-theme='card'] .card-track {
    font-size: calc(min(7cqmin, 11cqh) * var(--cosmos-font-scale, 1));
    font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .media[data-theme='card'] .card-artist {
    font-size: calc(min(5cqmin, 8cqh) * var(--cosmos-font-scale, 1));
    opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .media[data-theme='card'] .card-progress { display: flex; flex-direction: column; gap: 0.25rem; }
  .media[data-theme='card'] .card-controls { display: flex; align-items: center; justify-content: center; gap: 0.6rem; }

  /* ---------------- vinyl theme (image 3) ---------------- */
  .media[data-theme='vinyl'] {
    background: linear-gradient(180deg, #5fc6e8 0%, #f9d6a8 100%);
    color: #1a1a1a;
  }
  .media[data-theme='vinyl'] .vinyl-layout {
    position: relative; z-index: 1; display: flex; flex-direction: column;
    width: 100%; height: 100%; padding: 6% 6% 5%; box-sizing: border-box;
  }
  .media[data-theme='vinyl'] .vinyl-stage {
    position: relative; flex: 1; min-height: 0;
    display: flex; align-items: center; justify-content: center;
    /* Disc peeks out to the right of the art, which makes the whole
     * art+disc composition feel right-shifted inside the stage. Nudge
     * the stage's content slightly leftward so it looks visually
     * centered as a unit. */
    transform: translateX(-12%);
  }
  .media[data-theme='vinyl'] .vinyl-art {
    position: relative; z-index: 2;
    height: 100%; aspect-ratio: 1;
    object-fit: cover;
    box-shadow: 0 18px 40px rgba(0,0,0,0.35);
    border-radius: 2px;
  }
  .media[data-theme='vinyl'] .vinyl-art.placeholder { background: rgba(0,0,0,0.15); }
  .media[data-theme='vinyl'] .vinyl-disc {
    position: absolute; z-index: 1;
    top: 50%; left: 50%;
    height: 100%; aspect-ratio: 1;
    /* Disc peeks out to the right of the album art (z-index 2), so
     * we intentionally translate only on Y; the disc sits flush
     * against the art's right edge for the record-sleeve look. */
    transform: translate(0%, -50%);
    border-radius: 50%;
    background: radial-gradient(circle at center, #1a1a1a 0%, #1a1a1a 33%, #0a0a0a 36%, #1a1a1a 100%);
    box-shadow: 0 14px 28px rgba(0,0,0,0.45), inset 0 0 24px rgba(0,0,0,0.5);
    overflow: hidden;
  }
  .media[data-theme='vinyl'] .vinyl-disc-grooves {
    position: absolute; inset: 0; border-radius: 50%;
    background: repeating-radial-gradient(circle at center, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 4px);
  }
  .media[data-theme='vinyl'] .vinyl-disc-label {
    position: absolute; top: 50%; left: 50%; width: 40%; aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background-color: #b85c3a; background-size: cover; background-position: center;
    filter: saturate(1.1);
  }
  .media[data-theme='vinyl'] .vinyl-disc-hole {
    position: absolute; top: 50%; left: 50%; width: 4%; aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: 50%; background: #000;
  }
  @media (prefers-reduced-motion: no-preference) {
    .media[data-theme='vinyl'] .vinyl-disc.spinning { animation: cosmos-vinyl-spin 6s linear infinite; }
  }
  @keyframes cosmos-vinyl-spin { from { transform: translate(0%, -50%) rotate(0deg); } to { transform: translate(0%, -50%) rotate(360deg); } }
  .media[data-theme='vinyl'] .vinyl-meta {
    margin-top: 5%; text-align: center;
  }
  .media[data-theme='vinyl'] .vinyl-title {
    font-size: calc(min(10cqmin, 14cqh) * var(--cosmos-font-scale, 1));
    font-weight: 300; letter-spacing: 0.3em; text-transform: uppercase;
    line-height: 1.1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .media[data-theme='vinyl'] .vinyl-artist {
    font-size: calc(min(5cqmin, 8cqh) * var(--cosmos-font-scale, 1));
    letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.7; margin-top: 0.4rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .media[data-theme='vinyl'] .vinyl-album {
    font-size: calc(min(4.2cqmin, 7cqh) * var(--cosmos-font-scale, 1));
    letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.55; margin-top: 0.25rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .media[data-theme='vinyl'] .vinyl-progress { margin-top: 0.6rem; }
  .media[data-theme='vinyl'] .vinyl-progress .bar { background: rgba(0,0,0,0.15); }
  .media[data-theme='vinyl'] .vinyl-progress .fill { background: rgba(0,0,0,0.55); }

  /* Transparent mode: drop the card / gradient backgrounds for every
   * theme so the media-player content overlays directly on the scene
   * background. Inner element backgrounds (album art, vinyl disc,
   * progress bars) are kept for legibility. */
  .media.transparent,
  .media.transparent[data-theme='cinematic'],
  .media.transparent[data-theme='card'],
  .media.transparent[data-theme='vinyl'] {
    background: transparent;
  }
  .media.transparent .bg { display: none; }
</style>
