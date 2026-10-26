<script lang="ts">
  import type { LyricsLine } from '$lib/types';
  import { hash } from './poster';
  import { faceCss, pickFace, type Face } from './fonts';
  import { placeLine, type Rect } from './place';

  export let lines: LyricsLine[];
  export let index: number;
  export let playing: boolean;
  export let trackKey: string;
  export let faces: Face[] | null = null;
  /** Seconds into the current line when it started showing (joined late / seek). */
  export let elapsed = 0;
  export let duration: number | undefined = undefined;

  /**
   * Up to CONCURRENT lines float at once: a line lives until the line
   * CONCURRENT after it starts (minus a short handoff). Text never overlaps
   * because each new line is measured and placed clear of every line still
   * floating — see `place` below.
   */
  const CONCURRENT = 3;
  const HANDOFF_S = 0.25;
  /** Long instrumental gaps: a line still dissolves; the space just rests empty. */
  const MAX_LIFE_S = 14;
  /** Float travel each way, as a fraction of the box height (matches drift-move's 3.5cqh). */
  const TRAVEL = 0.035;
  const GAP_PX = 12;
  const FIT_STEPS = [1, 0.85, 0.7, 0.55, 0.4];

  /**
   * How far into its life each line was when it mounted, by key. Frozen at first
   * sight: changing a running animation's delay makes it jump, so an older line
   * must never get a recomputed offset when a newer line arrives.
   */
  const lateByKey = new Map<string, number>();
  function lateFor(key: string, now: number): number {
    if (!lateByKey.has(key)) lateByKey.set(key, now);
    return lateByKey.get(key)!;
  }

  /** Space each floating line sweeps over its whole life, by key. */
  const taken = new Map<string, Rect>();

  /**
   * Measure a just-mounted line and put it somewhere it can float its whole
   * life without touching another line or leaving the box. Runs once per line;
   * existing lines never move.
   */
  // Runs on a wrapper with no `style` attribute: Svelte rewrites the line's own
  // style on every re-render, which would wipe a position set there.
  function place(node: HTMLElement, p: { key: string; seed: number }) {
    let gone = false;
    node.style.visibility = 'hidden';
    // Fonts load on first use; measuring in the fallback face and then swapping
    // re-wraps the line bigger than the space reserved for it. Wait for it.
    const line = node.firstElementChild as HTMLElement;
    const ready = typeof document !== 'undefined' && document.fonts ? document.fonts.load(getComputedStyle(line).font) : null;
    if (ready) ready.catch(() => {}).then(() => !gone && settle(node, line, p.key, p.seed));
    else settle(node, line, p.key, p.seed);
    return {
      destroy: () => {
        gone = true;
        taken.delete(p.key);
        lateByKey.delete(p.key);
      },
    };
  }

  function settle(node: HTMLElement, line: HTMLElement, key: string, seed: number) {
    const box = node.parentElement!;
    const travel = TRAVEL * box.clientHeight;
    // Crowded? Shrink this line in steps until it fits clear of the others; the
    // font-size clamp still holds it at the readability floor.
    let r!: Rect, w = 0, h = 0;
    for (const fit of FIT_STEPS) {
      node.style.setProperty('--fit', String(fit));
      const cs = getComputedStyle(line);
      const padX = 0.8 * (parseFloat(cs.fontSize) || 16); // sideways wander (--dx)
      // A tilted face's painted box is bigger than its layout box.
      const tilt = Math.abs(Math.sin(((parseFloat(cs.rotate) || 0) * Math.PI) / 180));
      w = line.offsetWidth + line.offsetHeight * tilt;
      h = line.offsetHeight + line.offsetWidth * tilt;
      const spot = placeLine(
        { w: w + 2 * padX + GAP_PX, h: h + 2 * travel + GAP_PX },
        { w: box.clientWidth, h: box.clientHeight },
        [...taken.values()],
        seed,
      );
      r = spot;
      node.style.left = `${spot.x + padX + GAP_PX / 2 + (w - line.offsetWidth) / 2}px`;
      node.style.top = `${spot.y + travel + GAP_PX / 2 + (h - line.offsetHeight) / 2}px`;
      if (spot.clear) break;
    }
    // Lock the measured wrap: a line's width must not change once its space is reserved.
    node.style.width = `${Math.ceil(line.offsetWidth) + 1}px`;
    node.style.visibility = '';
    taken.set(key, r);
  }

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
      : lines.slice(Math.max(0, index - (CONCURRENT - 1)), index + 1).map((line, n, arr) => {
          const j = index - (arr.length - 1 - n);
          const h = hash(`${line.text}:${j}`);
          const face = faces ? pickFace(faces, `${line.text}:${j}`, line.text.length) : null;
          return {
            key: `${trackKey}:${j}`,
            line,
            current: j === index,
            words: wordTimes(line.text, tOf(j + 1) - tOf(j)),
            seed: h,
            life: r2(Math.max(0.8, Math.min(tOf(j + CONCURRENT) - tOf(j) - HANDOFF_S, MAX_LIFE_S))),
            // How far into this line we already are (older lines on a late join).
            late: lateFor(`${trackKey}:${j}`, r2(Math.max(0, tOf(index) - tOf(j) + elapsed))),
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
    <div class="slot" use:place={{ key: v.key, seed: v.seed }}>
      <p
        class="line"
        class:chorus={v.line.chorus}
        style="--life: {v.life}s; --late: -{v.late}s; --s: {v.size}; --dx: {v.dx}em; {v.face}"
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
       is larger — however small the mood's size jitter makes a line. Ceiling keeps
       three lines placeable side by side without crowding. */
    --drift-min: max(20px, 5cqh);
    --drift-max: max(16cqh, var(--drift-min));
  }
  .slot {
    /* The size ceiling shrinks with --fit too, or a capped line couldn't get smaller. */
    --drift-cap: max(var(--drift-min), calc(var(--drift-max) * var(--fit, 1)));
    position: absolute;
    left: 0;
    top: 0;
    max-width: 62%;
  }
  .line {
    margin: 0;
    font-family: var(--cosmos-font-Fraunces);
    font-weight: 300;
    font-size: clamp(var(--drift-min), calc(min(6cqw, 10cqh) * var(--lyr-k, 1) * var(--s) * var(--fit, 1)), var(--drift-cap));
    line-height: 1.15;
    text-wrap: balance;
    opacity: 0;
    /* Two layers: constant-speed motion for the whole life of the line (it never
       stops, so it reads as one continuous float) and a separate fade in → hold →
       fade out on top. The words reveal themselves (below), so the line itself
       appears at once. Travel is in cqh so placement can reserve it exactly. */
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
    font-size: clamp(var(--drift-min), calc(min(7.5cqw, 13cqh) * var(--lyr-k, 1) * var(--s) * var(--fit, 1)), var(--drift-cap));
  }
  @keyframes drift-move {
    from { transform: translate3d(0, 3.5cqh, 0); }
    to { transform: translate3d(var(--dx), -3.5cqh, 0); }
  }
  @keyframes word-in {
    from { opacity: 0; filter: blur(6px); transform: translate3d(0, 0.35em, 0); }
    to { opacity: 1; filter: none; transform: none; }
  }
  /* Old lines clear out briskly: hold while current and next, gone by ~2/3 of
     their life. The rest of the life is invisible (the space stays reserved). */
  @keyframes drift-fade {
    0% { opacity: 0; }
    3% { opacity: 0.95; }
    48% { opacity: 0.9; filter: blur(0); }
    66%, 100% { opacity: 0; filter: blur(5px); }
  }
</style>
