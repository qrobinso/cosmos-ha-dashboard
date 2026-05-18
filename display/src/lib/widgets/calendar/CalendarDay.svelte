<script lang="ts">
  import type { WidgetState, CalendarData, CalendarEvent } from '$lib/types';
  import { dateKey, resolveColor, minutesFromMidnight } from './eventLayout';
  import NowLine from './NowLine.svelte';

  export let widget: WidgetState;
  $: data = widget.data as CalendarData | null;
  $: sources = data?.sources ?? [];

  const HOUR_PX = 44;
  const START_HOUR = 6;
  const END_HOUR = 23;
  $: hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

  $: today = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
  $: todayKey = dateKey(today);
  $: dayLabel = today.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  $: todayEvents = (data?.events ?? []).filter((e) => {
    const s = new Date(e.start); const en = new Date(e.end);
    return s < new Date(today.getTime() + 86_400_000) && en > today;
  });
  $: allDay = todayEvents.filter((e) => e.all_day);
  $: timed = todayEvents.filter((e) => !e.all_day);

  function eventStyle(e: CalendarEvent): string {
    const startMin = Math.max(minutesFromMidnight(e.start), START_HOUR * 60);
    const endMin = Math.min(minutesFromMidnight(e.end), END_HOUR * 60 + 60);
    const top = ((startMin - START_HOUR * 60) / 60) * HOUR_PX;
    const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 16);
    return `top: ${top}px; height: ${height}px; --c: ${resolveColor(e, sources)}`;
  }

  function fmt(iso: string): string {
    const d = new Date(iso); const h = d.getHours() % 12 || 12; const m = String(d.getMinutes()).padStart(2, '0'); return `${h}:${m}${d.getHours()>=12?'p':'a'}`;
  }
</script>

<div class="day">
  <header><span class="title">{dayLabel}</span></header>
  {#if allDay.length}
    <div class="all-day-band">
      {#each allDay as e}
        <span class="chip" style="--c: {resolveColor(e, sources)}"><span class="dot"></span>{e.summary}</span>
      {/each}
    </div>
  {/if}
  <div class="grid" style="--hour-px: {HOUR_PX}px">
    <div class="hours">
      {#each hours as h}
        <div class="hour"><span class="lbl">{h % 12 || 12}{h >= 12 ? 'p' : 'a'}</span></div>
      {/each}
    </div>
    <div class="lane">
      {#each hours as h}<div class="line" style="top: {(h - START_HOUR) * HOUR_PX}px"></div>{/each}
      {#each timed as e (e.start + e.summary)}
        <div class="event" style={eventStyle(e)}>
          <span class="time">{fmt(e.start)}</span>
          <span class="summary">{e.summary}</span>
        </div>
      {/each}
      {#if dateKey(new Date()) === todayKey}
        <div class="now-wrap" style="top: -{START_HOUR * HOUR_PX}px"><NowLine pxPerHour={HOUR_PX} /></div>
      {/if}
    </div>
  </div>
</div>

<style>
  .day { display: flex; flex-direction: column; width: 100%; height: 100%; padding: 0.6rem; box-sizing: border-box; gap: 0.4rem; min-height: 0; }
  header .title { font-size: calc(1rem * var(--cosmos-font-scale, 1)); opacity: 0.85; }
  .all-day-band { display: flex; flex-wrap: wrap; gap: 0.3rem; padding: 0.3rem 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .chip { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: rgba(255,255,255,0.05); }
  .chip .dot { width: 0.4rem; height: 0.4rem; border-radius: 999px; background: var(--c); }
  .grid { flex: 1; display: grid; grid-template-columns: 2.4rem 1fr; gap: 0.4rem; overflow: hidden; min-height: 0; position: relative; }
  .hours { position: relative; }
  .hours .hour { height: var(--hour-px); position: relative; }
  .hours .lbl { position: absolute; top: -0.5em; right: 0.2rem; font-size: 0.65rem; opacity: 0.5; }
  .lane { position: relative; overflow: hidden; border-left: 1px solid rgba(255,255,255,0.06); }
  .line { position: absolute; left: 0; right: 0; height: 1px; background: rgba(255,255,255,0.05); }
  .event { position: absolute; left: 0.2rem; right: 0.2rem; background: rgba(255,255,255,0.08); border-left: 3px solid var(--c); border-radius: 0.25rem; padding: 0.15rem 0.4rem; overflow: hidden; }
  .event .time { font-size: 0.65rem; opacity: 0.7; margin-right: 0.4rem; }
  .event .summary { font-size: 0.78rem; }
  .now-wrap { position: absolute; left: 2.4rem; right: 0; top: 0; bottom: 0; pointer-events: none; }
</style>
