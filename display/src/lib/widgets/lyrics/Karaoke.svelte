<script lang="ts">
  import { fly } from 'svelte/transition';
  import type { LyricsLine } from '$lib/types';

  export let lines: LyricsLine[];
  export let index: number;
  export let gap: boolean;
  export let synced: boolean;
  export let playing: boolean;
  /** Seconds into the current line when it started showing, and its length. */
  export let elapsed: number;
  export let span: number;
  export let trackKey: string;

  $: current = index >= 0 ? lines[index] : null;
  $: next = lines[index + 1] ?? null;
</script>

<div class="kara" data-style="karaoke">
  {#if current && !gap}
    {#key `${trackKey}:${index}`}
      <div class="line" class:chorus={current.chorus} class:plain={!synced} data-current in:fly={{ y: 24, duration: 450 }}>
        <span class="base">{current.text}</span>
        {#if synced}
          <!-- shortcut: the fill sweeps the whole block at once, so a line that
               wraps fills every row together; per-row sweep if long lines bother. -->
          <span
            class="fill"
            aria-hidden="true"
            style="animation-duration: {span}s; animation-delay: -{elapsed}s; animation-play-state: {playing ? 'running' : 'paused'};"
          >{current.text}</span>
        {/if}
      </div>
    {/key}
  {:else}
    <div class="notes" aria-hidden="true">♪ ♪ ♪</div>
  {/if}
  {#if next}
    <div class="next">{next.text}</div>
  {/if}
</div>

<style>
  .kara {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.6em;
    padding: 0 6%;
  }
  .line {
    position: relative;
    font-family: var(--lyr-font, inherit);
    font-size: calc(min(9cqw, 20cqh) * var(--cosmos-font-scale, 1) * var(--lyr-scale, 1));
    font-weight: var(--lyr-weight, 800);
    line-height: 1.1;
    text-wrap: balance;
  }
  .base {
    opacity: 0.3;
  }
  /* Untimed lyrics have no sweep, so the line itself must read at full strength. */
  .plain .base {
    opacity: 1;
  }
  .fill {
    position: absolute;
    inset: 0;
    color: var(--lyr-accent);
    text-shadow: 0 0 0.5em color-mix(in oklab, var(--lyr-accent) 50%, transparent);
    clip-path: inset(0 100% 0 0);
    animation-name: sweep;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
  .line.chorus .fill {
    text-shadow: 0 0 0.9em color-mix(in oklab, var(--lyr-accent) 70%, transparent);
  }
  @keyframes sweep {
    to { clip-path: inset(0 0 0 0); }
  }
  .next {
    font-family: var(--lyr-font, inherit);
    font-size: calc(min(4.5cqw, 9cqh) * var(--cosmos-font-scale, 1) * var(--lyr-scale, 1));
    font-weight: var(--lyr-weight, 600);
    opacity: 0.38;
    text-wrap: balance;
  }
  .notes {
    font-size: calc(min(7cqw, 14cqh) * var(--cosmos-font-scale, 1));
    letter-spacing: 0.4em;
    color: var(--lyr-accent);
    animation: pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 0.9; }
  }
</style>
