<script lang="ts">
  import { cubicOut } from 'svelte/easing';
  import type { LyricsLine } from '$lib/types';
  import { hash, posterRecipe } from './poster';
  import { faceCss, pickFace, type Face } from './fonts';

  export let lines: LyricsLine[];
  export let index: number;
  export let gap: boolean;
  export let trackKey: string;
  /** Font mood faces to mix per part; null keeps the scene-font recipes. */
  export let faces: Face[] | null = null;

  $: current = index >= 0 && !gap ? lines[index] : null;
  $: parts = current ? posterRecipe(current.text).map((p, i) => ({ ...p, style: partStyle(current!.text, p.text, i) })) : [];

  // Each part gets its own face plus a size jitter (0.85–1.3×), seeded by the
  // line so a repeated chorus line comes back identical.
  function partStyle(line: string, text: string, i: number): string {
    if (!faces) return '';
    const face = pickFace(faces, `${line}:${i}`, text.length);
    const jitter = 0.85 + (hash(`${line}#${i}`) % 46) / 100;
    return `${faceCss(face)}; --fs: ${(jitter * (face.scale ?? 1)).toFixed(2)}`;
  }
  /** Long lines shrink so a poster never overflows its box. */
  $: k = current ? Math.min(1, Math.max(0.42, 4 / current.text.split(/\s+/).length)) : 1;

  // CSS-only transitions: focus in from a blur, drift past and dissolve out.
  function focusIn(_: Element, { duration = 700 } = {}) {
    return { duration, easing: cubicOut, css: (t: number) => `opacity:${t};transform:scale(${0.92 + 0.08 * t});filter:blur(${(1 - t) * 8}px)` };
  }
  function dissolve(_: Element, { duration = 500 } = {}) {
    return { duration, css: (t: number) => `opacity:${t};transform:scale(${1 + (1 - t) * 0.06});filter:blur(${(1 - t) * 5}px)` };
  }
</script>

<div class="poster" data-style="poster">
  {#if current}
    {#key `${trackKey}:${index}`}
      <div class="frame" class:chorus={current.chorus} style="--k: {k};" data-current in:focusIn out:dissolve>
        <!-- The space is a flex-ignored text node: keeps textContent readable. -->
        {#each parts as part, i}{#if i}{' '}{/if}<span class={part.cls} style={part.style}>{part.text}</span>{/each}
      </div>
    {/key}
  {/if}
</div>

<style>
  .poster {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    text-align: center;
    padding: 4%;
  }
  .frame {
    grid-area: 1 / 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 0.95;
    --u: calc(min(13cqw, 24cqh) * var(--lyr-k, 1) * var(--k));
  }
  .big {
    font-size: calc(var(--u) * var(--fs, 1));
    font-weight: 900;
    letter-spacing: -0.02em;
  }
  .serif {
    font-family: var(--cosmos-font-Fraunces);
    font-style: italic;
    font-weight: 300;
    font-size: calc(var(--u) * 0.82 * var(--fs, 1));
  }
  .mono {
    font-family: var(--cosmos-font-JetBrainsMono);
    text-transform: uppercase;
    letter-spacing: 0.3em;
    font-size: calc(var(--u) * 0.24 * var(--fs, 1));
    opacity: 0.75;
    margin-bottom: 0.6em;
  }
  .plain {
    font-weight: 300;
    font-size: calc(var(--u) * 0.48 * var(--fs, 1));
    letter-spacing: 0.04em;
  }
  .chorus {
    color: var(--lyr-accent);
    text-shadow: 0 0 0.45em color-mix(in oklab, var(--lyr-accent) 55%, transparent);
  }
  .chorus .big {
    text-transform: uppercase;
  }
</style>
