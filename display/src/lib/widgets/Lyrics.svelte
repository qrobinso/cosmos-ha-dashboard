<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { WidgetState, LyricsData, LyricsLine } from '$lib/types';
  import { livePosition, currentIndex, lineEnd, inGap, plainIndex } from './lyrics/timing';
  import Spotlight from './lyrics/Spotlight.svelte';
  import Karaoke from './lyrics/Karaoke.svelte';
  import Poster from './lyrics/Poster.svelte';
  import Drift from './lyrics/Drift.svelte';
  import { customFace, loadGoogleFont, moodFaces } from './lyrics/fonts';

  export let widget: WidgetState;

  const STYLES = ['spotlight', 'karaoke', 'poster', 'drift'];
  const TEXT_SIZES: Record<string, number> = { normal: 1, large: 1.25, xl: 1.5 };
  /** Default emphasis colour — warm gold, legible over the dark scenes kiosks run. */
  const DEFAULT_ACCENT = '#ffc65c';

  $: data = widget.data as LyricsData | null;
  $: cfg = widget.config as Record<string, unknown>;
  $: style = typeof cfg.style === 'string' && STYLES.includes(cfg.style) ? cfg.style : 'spotlight';
  $: offsetMs = typeof cfg.offset_ms === 'number' && Number.isFinite(cfg.offset_ms) ? cfg.offset_ms : 0;
  // A custom Google font becomes the main face: alone, or leading the mood's mix.
  $: custom = customFace(cfg.custom_font);
  $: if (custom) loadGoogleFont(custom.family);
  $: mood = moodFaces(cfg.font_mood);
  $: faces = custom ? [custom, ...(mood?.slice(1) ?? [])] : mood;
  $: main = faces?.[0];
  $: fontVars = main
    ? `--lyr-font: '${main.family}', var(--cosmos-font-Inter); --lyr-weight: ${main.weight}; --lyr-scale: ${main.scale ?? 1};`
    : '';
  $: textSize = TEXT_SIZES[cfg.text_size as string] ?? 1;
  $: opacity =
    typeof cfg.opacity === 'number' && cfg.opacity >= 0 && cfg.opacity <= 1 ? `opacity: ${cfg.opacity};` : '';
  $: accent = typeof cfg.accent === 'string' && cfg.accent.trim() ? cfg.accent.trim() : DEFAULT_ACCENT;
  // Without a reported position there's nothing to keep time against — every
  // push would snap back to line 0 — so hide rather than show the wrong words.
  $: lines = (data?.lines?.length && typeof data.position === 'number' ? data.lines : null) as LyricsLine[] | null;
  $: synced = !!data?.synced;
  $: playing = data?.state === 'playing';

  // Anchor each push's server-extrapolated position to its arrival on THIS
  // kiosk's monotonic clock; never compare against HA's wall clock.
  // Only a NEW data object is a new push: Svelte 4 re-sets object props on any
  // parent re-render (e.g. a transition completing), which must not re-anchor.
  let anchorMs = 0;
  let pushed = 0;
  let lastData: LyricsData | null = null;
  $: if (data && data !== lastData) {
    lastData = data;
    anchorMs = performance.now();
    pushed = data.position ?? 0;
  }

  let index = -1;
  let gap = false;
  /** Seconds into the current line, and its length — captured when the line
   *  changes so Karaoke's fill can run as a pure CSS animation. */
  let elapsed = 0;
  let span = 0;
  let lastTrack: string | undefined;

  function refresh(..._deps: unknown[]) {
    if (!lines) return;
    // A new song can land on the same line number — force a recompute.
    if (data?.track_key !== lastTrack) {
      lastTrack = data?.track_key;
      index = -2;
    }
    const pos = livePosition(pushed, anchorMs, performance.now(), playing, offsetMs);
    const i = synced ? currentIndex(lines, pos) : plainIndex(lines.length, pos, data?.duration);
    if (i !== index) {
      index = i;
      if (synced && i >= 0) {
        const start = lines[i].t ?? 0;
        elapsed = Math.max(0, pos - start);
        span = lineEnd(lines, i, data?.duration) - start;
      }
    }
    const g = synced && inGap(lines, pos);
    if (g !== gap) gap = g;
  }

  // Re-evaluate on every push, and on a light timer between pushes. Svelte only
  // touches the DOM when `index`/`gap` actually change, so the timer is cheap;
  // all visible motion is CSS.
  $: refresh(pushed, anchorMs, lines, playing, offsetMs, synced);
  const timer = setInterval(refresh, 100);
  onDestroy(() => clearInterval(timer));
</script>

{#if lines}
  <div class="lyrics" style="--lyr-accent: {accent}; --lyr-size: {textSize}; {fontVars} {opacity}">
    {#if style === 'karaoke'}
      <Karaoke {lines} {index} {gap} {synced} {playing} {elapsed} {span} trackKey={lastTrack ?? ""} />
    {:else if style === 'poster'}
      <Poster {lines} {index} {gap} {faces} trackKey={lastTrack ?? ''} />
    {:else if style === 'drift'}
      <Drift {lines} {index} {playing} {faces} trackKey={lastTrack ?? ''} />
    {:else}
      <Spotlight {lines} {index} {gap} {synced} />
    {/if}
  </div>
{/if}

<style>
  .lyrics {
    /* Every style sizes text by this: the scene's font scale × the widget's text size. */
    --lyr-k: calc(var(--cosmos-font-scale, 1) * var(--lyr-size, 1));
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>
