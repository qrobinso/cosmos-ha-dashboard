<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { WidgetState, LyricsData, LyricsLine } from '$lib/types';
  import { livePosition, currentIndex, lineEnd, inGap, plainIndex } from './lyrics/timing';
  import Spotlight from './lyrics/Spotlight.svelte';
  import Karaoke from './lyrics/Karaoke.svelte';
  import Poster from './lyrics/Poster.svelte';
  import Drift from './lyrics/Drift.svelte';

  export let widget: WidgetState;

  const STYLES = ['spotlight', 'karaoke', 'poster', 'drift'];
  /** Default emphasis colour — warm gold, legible over the dark scenes kiosks run. */
  const DEFAULT_ACCENT = '#ffc65c';

  $: data = widget.data as LyricsData | null;
  $: cfg = widget.config as Record<string, unknown>;
  $: style = typeof cfg.style === 'string' && STYLES.includes(cfg.style) ? cfg.style : 'spotlight';
  $: offsetMs = typeof cfg.offset_ms === 'number' && Number.isFinite(cfg.offset_ms) ? cfg.offset_ms : 0;
  $: accent = typeof cfg.accent === 'string' && cfg.accent.trim() ? cfg.accent.trim() : DEFAULT_ACCENT;
  $: lines = (data?.lines?.length ? data.lines : null) as LyricsLine[] | null;
  $: synced = !!data?.synced;
  $: playing = data?.state === 'playing';

  // Anchor each push's server-extrapolated position to its arrival on THIS
  // kiosk's monotonic clock; never compare against HA's wall clock.
  let anchorMs = 0;
  let pushed = 0;
  $: if (data) {
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
  <div class="lyrics" style="--lyr-accent: {accent};">
    {#if style === 'karaoke'}
      <Karaoke {lines} {index} {gap} {synced} {playing} {elapsed} {span} trackKey={lastTrack ?? ""} />
    {:else if style === 'poster'}
      <Poster {lines} {index} {gap} trackKey={lastTrack ?? ''} />
    {:else if style === 'drift'}
      <Drift {lines} {index} {playing} trackKey={lastTrack ?? ''} />
    {:else}
      <Spotlight {lines} {index} {gap} {synced} />
    {/if}
  </div>
{/if}

<style>
  .lyrics {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>
