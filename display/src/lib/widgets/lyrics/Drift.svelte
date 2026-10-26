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
  $: visible = index < 0 ? [] : lines.slice(first, index + 1).map((line, n, arr) => {
    const i = index - (arr.length - 1 - n);
    const h = hash(`${line.text}:${i}`);
    const face = faces ? pickFace(faces, `${line.text}:${i}`, line.text.length) : null;
    return {
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
    <span
      class:chorus={v.line.chorus}
      style="left: {v.left}%; top: {v.top}%; --s: {v.size}; --dx: {v.dx}em; {v.face}"
      data-current={v.current ? '' : undefined}
    >{v.line.text}</span>
  {/each}
</div>

<style>
  .drift {
    position: absolute;
    inset: 0;
  }
  span {
    position: absolute;
    max-width: 55%;
    font-family: var(--cosmos-font-Fraunces);
    font-weight: 300;
    font-size: calc(min(6cqw, 10cqh) * var(--lyr-k, 1) * var(--s));
    line-height: 1.15;
    text-wrap: balance;
    opacity: 0;
    /* Two layers: constant-speed motion for the whole life of the line (it never
       stops, so it reads as one continuous float) and a separate fade in → hold →
       fade out on top. Bigger lines rise further in em, which gives free parallax. */
    animation:
      drift-move 11s linear forwards,
      drift-fade 11s ease-in-out forwards;
  }
  .paused span {
    animation-play-state: paused;
  }
  span.chorus {
    font-style: italic;
    color: var(--lyr-accent);
    text-shadow: 0 0 0.6em color-mix(in oklab, var(--lyr-accent) 50%, transparent);
    font-size: calc(min(7.5cqw, 13cqh) * var(--lyr-k, 1) * var(--s));
  }
  @keyframes drift-move {
    from { transform: translate3d(0, 1.2em, 0); }
    to { transform: translate3d(var(--dx), -2.4em, 0); }
  }
  @keyframes drift-fade {
    0% { opacity: 0; filter: blur(8px); }
    18% { opacity: 0.95; filter: blur(0); }
    50% { opacity: 0.9; filter: blur(0); }
    100% { opacity: 0; filter: blur(5px); }
  }
</style>
