<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import type { WidgetState } from '$lib/types';
  import FitContent from '$lib/scene/FitContent.svelte';

  export let widget: WidgetState;

  let now = new Date();
  let timer: ReturnType<typeof setInterval>;

  $: format = (widget.config as { format?: string }).format ?? '24h';
  $: showSeconds = (widget.config as { show_seconds?: boolean }).show_seconds === true;

  $: hmStr = (() => {
    const m = String(now.getMinutes()).padStart(2, '0');
    if (format === '12h') {
      const h = now.getHours() % 12 || 12;
      return `${h}:${m}`;
    }
    return `${String(now.getHours()).padStart(2, '0')}:${m}`;
  })();
  $: ssStr = String(now.getSeconds()).padStart(2, '0');

  function fmtDate(d: Date): string {
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function startTimer(intervalMs: number) {
    clearInterval(timer);
    timer = setInterval(() => (now = new Date()), intervalMs);
  }

  onMount(() => startTimer(showSeconds ? 1000 : 30 * 1000));
  onDestroy(() => clearInterval(timer));

  $: if (timer !== undefined) startTimer(showSeconds ? 1000 : 30 * 1000);

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
    </div>
    <div class="date">{fmtDate(now)}</div>
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
    align-items: baseline;
    gap: 0;
  }
  .sep {
    margin: 0 0.04em;
  }
  .seconds-wrap {
    position: relative;
    display: inline-block;
    width: 2ch;
    height: 1em;
    vertical-align: baseline;
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
    will-change: transform, opacity;
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
