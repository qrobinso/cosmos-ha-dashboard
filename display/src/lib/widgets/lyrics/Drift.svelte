<script lang="ts">
  import type { LyricsLine } from '$lib/types';
  import { hash } from './poster';
  import { faceCss, pickFace, type Face } from './fonts';

  export let lines: LyricsLine[];
  export let index: number;
  export let playing: boolean;
  export let trackKey: string;
  export let faces: Face[] | null = null;

  /** Lines stay mounted until their 11s dissolve has played out: unmounting a
   *  line mid-fade pops it off at partial opacity. Timed lines leave once 12s
   *  older than the current one; untimed ones after 4 lines (~4s+ apart). */
  const LIFETIME_S = 12;
  const MAX_MOUNTED = 8;
  $: now = lines[index]?.t;
  $: first = Math.max(
    0,
    now === undefined
      ? index - 3
      : Math.max(index - (MAX_MOUNTED - 1), lines.findIndex((l) => (l.t ?? 0) >= now - LIFETIME_S)),
  );
  /**
   * When each word appears, in seconds after the line does. LRC times lines,
   * not words, so the words are spread across the sung part of the line —
   * weighted by length, since long words take longer to sing — at no faster
   * than a natural ~0.55s a word, and never past 3/4 of the gap to the next line.
   */
  function wordTimes(text: string, span: number | undefined) {
    const words = text.split(/\s+/).filter(Boolean);
    const reveal = span ? Math.min(span * 0.75, words.length * 0.55) : words.length * 0.35;
    const total = words.reduce((n, w) => n + w.length, 0) || 1;
    let before = 0;
    return words.map((w) => {
      const delay = (reveal * before) / total;
      before += w.length;
      return { text: w, delay: Math.round(delay * 100) / 100 };
    });
  }

  $: visible = index < 0 ? [] : lines.slice(first, index + 1).map((line, n, arr) => {
    const i = index - (arr.length - 1 - n);
    const h = hash(`${line.text}:${i}`);
    const face = faces ? pickFace(faces, `${line.text}:${i}`, line.text.length) : null;
    const next = lines[i + 1]?.t;
    return {
      words: wordTimes(line.text, line.t !== undefined && next !== undefined ? next - line.t : undefined),
      key: `${trackKey}:${i}`,
      line,
      current: i === index,
      // Loose spots inside the box, kept clear of the edges.
      left: 6 + (h % 46),
      top: 10 + ((h >>> 8) % 60),
      // Sideways wander per line (-0.8em..0.8em) so lines don't rise in lockstep.
      dx: (((h >>> 4) % 17) - 8) / 10,
      // A font mood widens the size range (0.6–1.5×) — mixing is the point.
      size: face ? (0.6 + ((h >>> 16) % 90) / 100) * (face.scale ?? 1) : 0.75 + ((h >>> 16) % 50) / 100,
      face: face ? faceCss(face) : '',
    };
  });
</script>

<div class="drift" data-style="drift" class:paused={!playing}>
  {#each visible as v (v.key)}
    <p
      class="line"
      class:chorus={v.line.chorus}
      style="left: {v.left}%; top: {v.top}%; --s: {v.size}; --dx: {v.dx}em; {v.face}"
      data-current={v.current ? '' : undefined}
    >
      {#each v.words as w, n}{#if n}{' '}{/if}<span class="word" style="animation-delay: {w.delay}s;">{w.text}</span>{/each}
    </p>
  {/each}
</div>

<style>
  .drift {
    position: absolute;
    inset: 0;
  }
  .line {
    position: absolute;
    margin: 0;
    max-width: 55%;
    font-family: var(--cosmos-font-Fraunces);
    font-weight: 300;
    font-size: calc(min(6cqw, 10cqh) * var(--lyr-k, 1) * var(--s));
    line-height: 1.15;
    text-wrap: balance;
    opacity: 0;
    /* Two layers: constant-speed motion for the whole life of the line (it never
       stops, so it reads as one continuous float) and a separate fade in → hold →
       fade out on top. Bigger lines rise further in em, which gives free parallax.
       The words reveal themselves (below), so the line itself appears at once. */
    animation:
      drift-move 11s linear forwards,
      drift-fade 11s ease-in-out forwards;
  }
  .word {
    display: inline-block;
    animation: word-in 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .paused .line,
  .paused .word {
    animation-play-state: paused;
  }
  .line.chorus {
    font-style: italic;
    color: var(--lyr-accent);
    text-shadow: 0 0 0.6em color-mix(in oklab, var(--lyr-accent) 50%, transparent);
    font-size: calc(min(7.5cqw, 13cqh) * var(--lyr-k, 1) * var(--s));
  }
  @keyframes drift-move {
    from { transform: translate3d(0, 1.2em, 0); }
    to { transform: translate3d(var(--dx), -2.4em, 0); }
  }
  @keyframes word-in {
    from { opacity: 0; filter: blur(6px); transform: translate3d(0, 0.35em, 0); }
    to { opacity: 1; filter: none; transform: none; }
  }
  @keyframes drift-fade {
    0% { opacity: 0; }
    3% { opacity: 0.95; }
    50% { opacity: 0.9; filter: blur(0); }
    100% { opacity: 0; filter: blur(5px); }
  }
</style>
