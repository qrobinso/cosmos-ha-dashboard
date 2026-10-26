<script lang="ts">
  import type { LyricsLine } from '$lib/types';
  import { hash } from './poster';
  import { faceCss, pickFace, type Face } from './fonts';

  export let lines: LyricsLine[];
  export let index: number;
  export let playing: boolean;
  export let trackKey: string;
  export let faces: Face[] | null = null;
  /** Seconds into the current line when it started showing (joined late / seek). */
  export let elapsed = 0;
  export let duration: number | undefined = undefined;

  /**
   * Text never overlaps: the box is split into LANES horizontal lanes and line j
   * always takes lane j % LANES, so any LANES consecutive lines sit in different
   * lanes. A line lives until the line LANES after it starts (minus a short
   * handoff), so its lane is empty again before it's reused. Up to LANES lines
   * float at once.
   */
  const LANES = 3;
  /** Lane order top → bottom → middle reads less mechanical than top-down. */
  const LANE_ORDER = [0, 2, 1];
  const HANDOFF_S = 0.25;
  /** Long instrumental gaps: a line still dissolves; its lane just rests empty. */
  const MAX_LIFE_S = 14;

  /** Start time of line j; untimed lyrics are spaced evenly across the track. */
  function tOf(j: number): number {
    const per = duration ? duration / lines.length : 4;
    if (j >= lines.length) return Math.max(duration ?? 0, tOf(lines.length - 1) + 5);
    return lines[j].t ?? j * per;
  }

  /**
   * When each word appears, in seconds after the line does. LRC times lines,
   * not words, so the words are spread across the sung part of the line —
   * weighted by length, since long words take longer to sing — at no faster
   * than a natural ~0.55s a word, and never past 3/4 of the gap to the next line.
   */
  function wordTimes(text: string, gap: number) {
    const words = text.split(/\s+/).filter(Boolean);
    const reveal = Math.min(gap * 0.75, words.length * 0.55);
    const total = words.reduce((n, w) => n + w.length, 0) || 1;
    let before = 0;
    return words.map((w) => {
      const delay = (reveal * before) / total;
      before += w.length;
      return { text: w, delay: r2(delay) };
    });
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;

  $: visible =
    index < 0
      ? []
      : lines.slice(Math.max(0, index - (LANES - 1)), index + 1).map((line, n, arr) => {
          const j = index - (arr.length - 1 - n);
          const h = hash(`${line.text}:${j}`);
          const face = faces ? pickFace(faces, `${line.text}:${j}`, line.text.length) : null;
          const left = 4 + (h % 36);
          return {
            key: `${trackKey}:${j}`,
            line,
            current: j === index,
            words: wordTimes(line.text, tOf(j + 1) - tOf(j)),
            lane: LANE_ORDER[j % LANES],
            life: r2(Math.max(0.8, Math.min(tOf(j + LANES) - tOf(j) - HANDOFF_S, MAX_LIFE_S))),
            // How far into this line we already are (older lines on a late join).
            late: r2(Math.max(0, tOf(index) - tOf(j) + elapsed)),
            left,
            maxWidth: 94 - left,
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
    <div class="lane" style="top: {r2(v.lane * (100 / LANES))}%;">
      <p
        class="line"
        class:chorus={v.line.chorus}
        style="margin-left: {v.left}%; max-width: {v.maxWidth}%; --life: {v.life}s; --late: -{v.late}s; --s: {v.size}; --dx: {v.dx}em; {v.face}"
        data-current={v.current ? '' : undefined}
      >
        {#each v.words as w, n}{#if n}{' '}{/if}<span class="word" style="animation-delay: calc({w.delay}s + var(--late));">{w.text}</span>{/each}
      </p>
    </div>
  {/each}
</div>

<style>
  .drift {
    position: absolute;
    inset: 0;
    /* Readability floor: never below 20px or 5% of the widget's height, whichever
       is larger — however small the mood's size jitter makes a line. Ceiling: two
       wrapped rows plus the float must fit inside a third-height lane. */
    --drift-min: max(20px, 5cqh);
    --drift-max: max(11cqh, var(--drift-min));
  }
  /* One lane per concurrent line; clipping is the hard no-overlap guarantee. */
  .lane {
    position: absolute;
    left: 0;
    right: 0;
    height: calc(100% / 3);
    display: flex;
    align-items: center;
    overflow: hidden;
  }
  .line {
    margin: 0;
    font-family: var(--cosmos-font-Fraunces);
    font-weight: 300;
    font-size: clamp(var(--drift-min), calc(min(6cqw, 10cqh) * var(--lyr-k, 1) * var(--s)), var(--drift-max));
    line-height: 1.15;
    text-wrap: balance;
    opacity: 0;
    /* Two layers: constant-speed motion for the whole life of the line (it never
       stops, so it reads as one continuous float) and a separate fade in → hold →
       fade out on top. The words reveal themselves (below), so the line itself
       appears at once. Travel is in cqh so it stays inside the lane. */
    animation:
      drift-move var(--life) linear var(--late) forwards,
      drift-fade var(--life) ease-in-out var(--late) forwards;
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
    font-size: clamp(var(--drift-min), calc(min(7.5cqw, 13cqh) * var(--lyr-k, 1) * var(--s)), var(--drift-max));
  }
  @keyframes drift-move {
    from { transform: translate3d(0, 3.5cqh, 0); }
    to { transform: translate3d(var(--dx), -3.5cqh, 0); }
  }
  @keyframes word-in {
    from { opacity: 0; filter: blur(6px); transform: translate3d(0, 0.35em, 0); }
    to { opacity: 1; filter: none; transform: none; }
  }
  @keyframes drift-fade {
    0% { opacity: 0; }
    3% { opacity: 0.95; }
    75% { opacity: 0.9; filter: blur(0); }
    100% { opacity: 0; filter: blur(5px); }
  }
</style>
