<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { WidgetState } from '$lib/types';
  import FitContent from '$lib/scene/FitContent.svelte';

  export let widget: WidgetState;

  let now = new Date();
  let timer: ReturnType<typeof setInterval>;

  $: format = (widget.config as { format?: string }).format ?? '24h';
  $: showSeconds = (widget.config as { show_seconds?: boolean }).show_seconds === true;

  function fmtTime(d: Date): string {
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const tail = showSeconds ? `:${s}` : '';
    if (format === '12h') {
      const h = d.getHours() % 12 || 12;
      return `${h}:${m}${tail}`;
    }
    return `${String(d.getHours()).padStart(2, '0')}:${m}${tail}`;
  }

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
</script>

<FitContent>
  <div class="clock">
    <div class="time">{fmtTime(now)}</div>
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
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .date {
    font-size: calc(min(8cqmin, 12cqh) * var(--cosmos-font-scale, 1));
    opacity: 0.7;
  }
</style>
