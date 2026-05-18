<script lang="ts">
  import type { WidgetState, CalendarData, CalendarEvent } from '$lib/types';
  import { startOfWeek, addDays, dateKey, resolveColor, minutesFromMidnight } from './eventLayout';
  import NowLine from './NowLine.svelte';

  export let widget: WidgetState;
  $: data = widget.data as CalendarData | null;
  $: sources = data?.sources ?? [];

  const HOUR_PX = 36, START_HOUR = 6, END_HOUR = 23;
  $: hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

  $: weekStart = startOfWeek(new Date(), 0);
  $: days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  $: todayKey = dateKey(new Date());
  $: rangeLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  function dayEvents(d: Date): { allDay: CalendarEvent[]; timed: CalendarEvent[] } {
    const dayStart = d.getTime();
    const dayEnd = dayStart + 86_400_000;
    const evs = (data?.events ?? []).filter((e) => {
      const es = new Date(e.start).getTime(); const ee = new Date(e.end).getTime();
      return es < dayEnd && ee > dayStart;
    });
    return { allDay: evs.filter((e) => e.all_day), timed: evs.filter((e) => !e.all_day) };
  }

  function eventStyle(e: CalendarEvent): string {
    const startMin = Math.max(minutesFromMidnight(e.start), START_HOUR * 60);
    const endMin = Math.min(minutesFromMidnight(e.end), END_HOUR * 60 + 60);
    const top = ((startMin - START_HOUR * 60) / 60) * HOUR_PX;
    const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 14);
    return `top: ${top}px; height: ${height}px; --c: ${resolveColor(e, sources)}`;
  }
</script>

<div class="week">
  <header><span class="title">{rangeLabel}</span></header>
  <div class="day-heads">
    <div class="gutter"></div>
    {#each days as d (dateKey(d))}
      <div class="dh" class:today={dateKey(d) === todayKey}>
        <span class="dow">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
        <span class="num">{d.getDate()}</span>
      </div>
    {/each}
  </div>
  <div class="all-day">
    <div class="gutter">all-day</div>
    {#each days as d (dateKey(d))}
      {@const ad = dayEvents(d).allDay}
      <div class="ad-cell">
        {#each ad as e}<span class="chip" style="--c: {resolveColor(e, sources)}"><span class="dot"></span>{e.summary}</span>{/each}
      </div>
    {/each}
  </div>
  <div class="grid">
    <div class="hours">
      {#each hours as h}<div class="hr"><span>{h % 12 || 12}{h >= 12 ? 'p' : 'a'}</span></div>{/each}
    </div>
    {#each days as d (dateKey(d))}
      {@const td = dayEvents(d).timed}
      <div class="lane" class:today={dateKey(d) === todayKey}>
        {#each hours as h}<div class="line" style="top: {(h - START_HOUR) * HOUR_PX}px"></div>{/each}
        {#each td as e (e.start + e.summary)}<div class="event" style={eventStyle(e)}><span class="s">{e.summary}</span></div>{/each}
        {#if dateKey(d) === todayKey}<NowLine pxPerHour={HOUR_PX} />{/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .week { display: flex; flex-direction: column; width: 100%; height: 100%; padding: 0.5rem; box-sizing: border-box; gap: 0.3rem; min-height: 0; }
  header .title { font-size: calc(0.9rem * var(--cosmos-font-scale, 1)); opacity: 0.85; }
  .day-heads, .all-day, .grid { display: grid; grid-template-columns: 2.4rem repeat(7, 1fr); gap: 0; }
  .day-heads .dh { padding: 0.2rem 0.3rem; display: flex; flex-direction: column; align-items: flex-start; }
  .day-heads .dh.today .num { background: var(--cosmos-fg, #fff); color: var(--cosmos-bg, #000); border-radius: 999px; padding: 0 0.4em; }
  .day-heads .dow { font-size: 0.65rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.1em; }
  .day-heads .num { font-size: 0.85rem; }
  .all-day { border-top: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06); min-height: 1.4rem; }
  .all-day .gutter { font-size: 0.55rem; opacity: 0.4; padding: 0.2rem 0.3rem; text-transform: uppercase; }
  .all-day .ad-cell { display: flex; flex-wrap: wrap; gap: 0.15rem; padding: 0.15rem; border-left: 1px solid rgba(255,255,255,0.04); }
  .chip { display: inline-flex; align-items: center; gap: 0.2rem; font-size: 0.65rem; padding: 0.05rem 0.3rem; border-radius: 999px; background: rgba(255,255,255,0.06); }
  .chip .dot { width: 0.35rem; height: 0.35rem; border-radius: 999px; background: var(--c); }
  .grid { flex: 1; overflow: hidden; min-height: 0; position: relative; }
  .hours { position: relative; }
  .hours .hr { height: 36px; position: relative; }
  .hours .hr span { position: absolute; right: 0.2rem; top: -0.5em; font-size: 0.6rem; opacity: 0.5; }
  .lane { position: relative; border-left: 1px solid rgba(255,255,255,0.04); overflow: hidden; }
  .lane.today { background: rgba(255,255,255,0.02); }
  .line { position: absolute; left: 0; right: 0; height: 1px; background: rgba(255,255,255,0.04); }
  .event { position: absolute; left: 0.1rem; right: 0.1rem; background: rgba(255,255,255,0.08); border-left: 2px solid var(--c); border-radius: 0.2rem; padding: 0.05rem 0.25rem; font-size: 0.65rem; line-height: 1.15; overflow: hidden; }
</style>
