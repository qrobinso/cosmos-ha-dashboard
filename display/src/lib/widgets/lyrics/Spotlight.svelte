<script lang="ts">
  import { tick } from 'svelte';
  import type { LyricsLine } from '$lib/types';

  export let lines: LyricsLine[];
  export let index: number;
  export let gap: boolean;
  export let synced: boolean;

  let box: HTMLDivElement;
  let els: HTMLLIElement[] = [];
  let y = 0;

  // Center the current line. Measured (not computed from a fixed line height)
  // because long lines wrap. Recomputed only when the line changes.
  $: recenter(index, lines);
  async function recenter(..._deps: unknown[]) {
    await tick();
    const el = els[Math.max(0, index)];
    if (!el || !box) return;
    y = box.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2);
  }
</script>

<div class="spot" class:gap data-style="spotlight" bind:this={box}>
  <ol style="transform: translate3d(0, {y}px, 0);">
    {#each lines as line, i}
      <li
        bind:this={els[i]}
        class:active={synced && i === index && !gap}
        class:past={i < index}
        class:chorus={line.chorus}
        data-current={i === Math.max(0, index) ? '' : undefined}
      >
        {line.text}
      </li>
    {/each}
  </ol>
  {#if gap}<div class="notes" aria-hidden="true">♪ ♪ ♪</div>{/if}
</div>

<style>
  .spot {
    position: absolute;
    inset: 0;
    -webkit-mask-image: linear-gradient(transparent, #000 22%, #000 78%, transparent);
    mask-image: linear-gradient(transparent, #000 22%, #000 78%, transparent);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0 6%;
    transition: transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1);
    will-change: transform;
  }
  li {
    font-size: calc(min(7cqw, 11cqh) * var(--cosmos-font-scale, 1));
    font-weight: 700;
    line-height: 1.2;
    padding: 0.28em 0;
    text-wrap: balance;
    opacity: 0.38;
    transform-origin: left center;
    transition: opacity 500ms ease, transform 500ms cubic-bezier(0.2, 0.8, 0.2, 1), color 500ms ease;
  }
  li.past {
    opacity: 0.2;
  }
  li.chorus {
    color: color-mix(in oklab, currentColor 70%, var(--lyr-accent));
  }
  li.active {
    opacity: 1;
    transform: scale(1.06);
  }
  li.active.chorus {
    color: var(--lyr-accent);
    text-shadow: 0 0 0.6em color-mix(in oklab, var(--lyr-accent) 45%, transparent);
  }
  .gap li {
    opacity: 0.18;
  }
  .notes {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: calc(min(6cqw, 10cqh) * var(--cosmos-font-scale, 1));
    letter-spacing: 0.4em;
    color: var(--lyr-accent);
    animation: pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.25; transform: scale(0.96); }
    50% { opacity: 0.9; transform: scale(1.04); }
  }
</style>
