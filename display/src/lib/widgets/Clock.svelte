<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import type { WidgetState } from '$lib/types';
  import FitContent from '$lib/scene/FitContent.svelte';

  export let widget: WidgetState;

  let now = new Date();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeMode: 'seconds' | 'minutes' | null = null;

  $: format = (widget.config as { format?: string }).format ?? '24h';
  $: showSeconds = (widget.config as { show_seconds?: boolean }).show_seconds === true;
  $: showDate = (widget.config as { show_date?: boolean }).show_date !== false;
  // AM/PM only meaningful in 12h mode. Default on for 12h, irrelevant for 24h.
  $: showAmPm = (widget.config as { show_ampm?: boolean }).show_ampm !== false;

  $: hmStr = (() => {
    const m = String(now.getMinutes()).padStart(2, '0');
    if (format === '12h') {
      const h = now.getHours() % 12 || 12;
      return `${h}:${m}`;
    }
    return `${String(now.getHours()).padStart(2, '0')}:${m}`;
  })();
  $: ssStr = String(now.getSeconds()).padStart(2, '0');
  $: ampmStr = format === '12h' && showAmPm ? (now.getHours() >= 12 ? 'PM' : 'AM') : null;

  function fmtDate(d: Date): string {
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // Schedule the next tick aligned to the next second (seconds mode) or the next
  // minute boundary (minutes mode). A chained setTimeout — not setInterval — so a
  // device sleep/wake doesn't queue catch-up callbacks; we just resync on resume.
  function scheduleTick(mode: 'seconds' | 'minutes') {
    if (timer) clearTimeout(timer);
    activeMode = mode;
    const d = new Date();
    const delay = mode === 'seconds'
      ? 1000 - d.getMilliseconds()
      : (60 - d.getSeconds()) * 1000 - d.getMilliseconds();
    timer = setTimeout(() => {
      now = new Date();
      if (activeMode === mode) scheduleTick(mode);
    }, Math.max(50, delay));
  }

  onMount(() => scheduleTick(showSeconds ? 'seconds' : 'minutes'));
  onDestroy(() => { if (timer) clearTimeout(timer); });

  // Only restart when the mode actually flips, not on every WS push.
  $: {
    const wanted: 'seconds' | 'minutes' = showSeconds ? 'seconds' : 'minutes';
    if (activeMode !== null && activeMode !== wanted) scheduleTick(wanted);
  }

  function tickIn(_node: Element, { duration = 350 }: { duration?: number } = {}) {
    return {
      duration,
      easing: cubicOut,
      css: (t: number) => `transform: translateY(${(1 - t) * 100}%); opacity: ${t};`,
    };
  }
  function tickOut(_node: Element, { duration = 350 }: { duration?: number } = {}) {
    return {
      duration,
      easing: cubicOut,
      css: (t: number) => `transform: translateY(${-(1 - t) * 100}%); opacity: ${t};`,
    };
  }
</script>

<FitContent>
  <div class="clock">
    <div class="time">
      <span class="hm">{hmStr}</span>
      {#if showSeconds}
        <span class="sep">:</span>
        <span class="seconds-wrap" aria-label="seconds">
          {#key ssStr}
            <span class="sec" in:tickIn={{ duration: 380 }} out:tickOut={{ duration: 380 }}>{ssStr}</span>
          {/key}
        </span>
      {/if}
      {#if ampmStr}
        <span class="ampm">{ampmStr}</span>
      {/if}
    </div>
    {#if showDate}
      <div class="date">{fmtDate(now)}</div>
    {/if}
  </div>
</FitContent>

<style>
  .clock {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    white-space: nowrap;
  }
  .time {
    font-size: calc(min(28cqmin, 38cqh) * var(--cosmos-font-scale, 1));
    font-weight: 200;
    line-height: 1.1;
    letter-spacing: -0.02em;
    display: inline-flex;
    align-items: center;
    gap: 0;
  }
  .hm,
  .sep {
    line-height: 1.1;
  }
  .sep {
    margin: 0 0.04em;
  }
  .seconds-wrap {
    position: relative;
    display: inline-block;
    width: 2ch;
    height: 1.1em;
    line-height: 1.1;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%);
    mask-image: linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%);
  }
  .sec {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    will-change: transform, opacity;
  }
  .ampm {
    font-size: 0.32em;
    font-weight: 400;
    letter-spacing: 0.06em;
    margin-left: 0.4em;
    opacity: 0.7;
    align-self: center;
    line-height: 1;
  }
  .date {
    font-size: calc(min(8cqmin, 12cqh) * var(--cosmos-font-scale, 1));
    opacity: 0.7;
  }
  @media (prefers-reduced-motion: reduce) {
    .sec {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
