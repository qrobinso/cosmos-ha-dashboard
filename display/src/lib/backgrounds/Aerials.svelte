<script lang="ts">
  /**
   * Apple TV aerial backdrop.
   *
   * Two stacked <video> elements take turns: the incoming clip loads in the
   * hidden one and is only faded up on `canplay`, while the outgoing clip
   * stays visible underneath — so a change never shows a black frame. The
   * playlist and rotation timer live here rather than on the server: a
   * re-push that carries the same clip set leaves playback untouched.
   */
  import { onDestroy, onMount } from 'svelte';
  import type { AerialClip } from '$lib/types';

  export let clips: AerialClip[] = [];
  export let shuffle = false;
  /** Minutes between clips; 0 = advance when the clip ends. */
  export let intervalMin = 30;
  /** Crossfade duration in ms. */
  export let fadeMs = 800;

  type Slot = { src: string | null; visible: boolean; el: HTMLVideoElement | null };
  let slots: [Slot, Slot] = [
    { src: null, visible: false, el: null },
    { src: null, visible: false, el: null },
  ];
  /** Slot currently on screen. */
  let active = 0;
  /** Slot loading the next clip, or -1 when nothing is pending. */
  let pending = -1;

  let order: AerialClip[] = [];
  let pos = 0;
  let setKey = '';
  let failures = 0;
  let reduce = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let rotateTimer: ReturnType<typeof setInterval> | null = null;

  $: loop = intervalMin > 0;

  function byId(list: AerialClip[]): AerialClip[] {
    const out = [...list];
    if (!shuffle) return out;
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function current(): AerialClip | null {
    return order[pos] ?? null;
  }

  /** Rebuild the pass; when shuffled, never open with the clip just shown. */
  function nextPass(): void {
    const prev = current();
    order = byId(clips);
    if (shuffle && order.length > 1 && prev && order[0].id === prev.id) {
      [order[0], order[order.length - 1]] = [order[order.length - 1], order[0]];
    }
    pos = 0;
  }

  function show(clip: AerialClip): void {
    const target = pending !== -1 ? pending : 1 - active;
    pending = target;
    slots[target] = { ...slots[target], src: clip.url, visible: false };
    slots = slots;
  }

  function advance(): void {
    if (order.length === 0) return;
    if (order.length === 1) {
      // Only one clip: the timer must not reload it mid-play; `loop` keeps
      // it going. With interval 0 the `ended` handler restarts it below.
      if (!loop && slots[active].el) {
        slots[active].el!.currentTime = 0;
        void slots[active].el!.play()?.catch(() => {});
      }
      return;
    }
    pos += 1;
    if (pos >= order.length) nextPass();
    const clip = current();
    if (clip) show(clip);
  }

  function onCanPlay(i: number): void {
    if (i !== pending) return;
    const old = active;
    active = i;
    pending = -1;
    failures = 0;
    slots[i] = { ...slots[i], visible: true };
    slots[old] = { ...slots[old], visible: false };
    slots = slots;
    if (reduce) slots[i].el?.pause();
    else void slots[i].el?.play()?.catch(() => {});

    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      if (old !== active) release(old);
    }, fadeMs);
  }

  function release(i: number): void {
    const el = slots[i].el;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    slots[i] = { ...slots[i], src: null, visible: false };
    slots = slots;
  }

  function onError(i: number): void {
    if (i !== pending && i !== active) return;
    failures += 1;
    if (failures >= order.length) {
      // Every clip has failed (cache evicted, server down): stop rather
      // than hammer the stream route in a loop. The next clip-set change
      // or interval tick starts over.
      release(0);
      release(1);
      pending = -1;
      return;
    }
    if (i === active) slots[i] = { ...slots[i], visible: false };
    advance();
  }

  function onEnded(i: number): void {
    if (i !== active || loop) return;
    advance();
  }

  function applyClips(list: AerialClip[]): void {
    const key = list.map((c) => c.id).sort().join('|');
    if (key === setKey) return;
    setKey = key;
    failures = 0;
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    pending = -1;
    if (list.length === 0) {
      order = [];
      release(0);
      release(1);
      return;
    }
    order = byId(list);
    pos = 0;
    show(order[0]);
  }
  $: applyClips(clips);

  function resetTimer(minutes: number): void {
    if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
    if (minutes > 0) rotateTimer = setInterval(advance, minutes * 60_000);
  }
  $: resetTimer(intervalMin);

  onMount(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  });
  onDestroy(() => {
    if (rotateTimer) clearInterval(rotateTimer);
    if (releaseTimer) clearTimeout(releaseTimer);
  });
</script>

<div class="aerials">
  {#each slots as slot, i}
    <video
      bind:this={slots[i].el}
      src={slot.src}
      class="aerial"
      style="opacity: {slot.visible ? 1 : 0}; transition: opacity {fadeMs}ms ease-in-out;"
      muted
      playsinline
      autoplay
      loop={loop || undefined}
      preload="auto"
      disablepictureinpicture
      disableremoteplayback
      on:canplay={() => onCanPlay(i)}
      on:error={() => onError(i)}
      on:ended={() => onEnded(i)}
    ></video>
  {/each}
</div>

<style>
  .aerials {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #000;
  }
  .aerial {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    will-change: opacity;
  }
</style>
