<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { WidgetState } from '$lib/types';

  export let widget: WidgetState;

  let now = new Date();
  let timer: ReturnType<typeof setInterval>;

  $: format = (widget.config as { format?: string }).format ?? '24h';

  function fmtTime(d: Date): string {
    if (format === '12h') {
      const h = d.getHours() % 12 || 12;
      return `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function fmtDate(d: Date): string {
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  onMount(() => {
    timer = setInterval(() => (now = new Date()), 30 * 1000);
  });
  onDestroy(() => clearInterval(timer));
</script>

<div class="clock">
  <div class="time">{fmtTime(now)}</div>
  <div class="date">{fmtDate(now)}</div>
</div>

<style>
  .clock {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }
  .time {
    font-size: clamp(2.5rem, 8vw, 6rem);
    font-weight: 200;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .date {
    font-size: clamp(0.85rem, 1.5vw, 1.25rem);
    opacity: 0.7;
  }
</style>
