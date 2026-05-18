<script lang="ts">
  import type { WidgetState, CalendarData, CalendarEvent } from '$lib/types';
  import { resolveColor, minutesFromMidnight, dateKey } from './eventLayout';
  import NowLine from './NowLine.svelte';

  export let widget: WidgetState;
  $: data = widget.data as CalendarData | null;
  $: sources = data?.sources ?? [];

  const HOUR_PX = 36, START_HOUR = 6, END_HOUR = 23;
  $: hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

  $: today = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
  $: dayLabel = today.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  $: todayEvents = (data?.events ?? []).filter((e) => {
    const s = new Date(e.start).getTime(); const en = new Date(e.end).getTime();
    return s < today.getTime() + 86_400_000 && en > today.getTime();
  });
  $: timedToday = todayEvents.filter((e) => !e.all_day);
  $: allDayToday = todayEvents.filter((e) => e.all_day);

  function laneEvents(sourceId: string): CalendarEvent[] {
    return timedToday.filter((e) => e.source_id === sourceId);
  }

  function laneAllDay(sourceId: string): CalendarEvent[] {
    return allDayToday.filter((e) => e.source_id === sourceId);
  }

  function eventStyle(e: CalendarEvent): string {
    const startMin = Math.max(minutesFromMidnight(e.start), START_HOUR * 60);
    const endMin = Math.min(minutesFromMidnight(e.end), END_HOUR * 60 + 60);
    const top = ((startMin - START_HOUR * 60) / 60) * HOUR_PX;
    const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 14);
    return `top: ${top}px; height: ${height}px; --c: ${resolveColor(e, sources)}`;
  }
</script>

<div class="lanes-view">
  <header><span class="title">{dayLabel}</span></header>
  {#if sources.length === 0}
    <div class="empty">Add at least one calendar source to use Lanes view.</div>
  {:else}
    <div class="lane-heads" style="grid-template-columns: 2.4rem repeat({sources.length}, 1fr)">
      <div></div>
      {#each sources as s (s.id)}
        <div class="lh"><span class="dot" style="background: {s.color}"></span><span>{s.label}</span></div>
      {/each}
    </div>
    {#if allDayToday.length}
      <div class="all-day" style="grid-template-columns: 2.4rem repeat({sources.length}, 1fr)">
        <div class="gutter">all-day</div>
        {#each sources as s (s.id)}
          <div class="ad">
            {#each laneAllDay(s.id) as e}
              <span class="chip" style="--c: {resolveColor(e, sources)}">{e.summary}</span>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
    <div class="grid" style="grid-template-columns: 2.4rem repeat({sources.length}, 1fr)">
      <div class="hours">
        {#each hours as h}<div class="hr"><span>{h % 12 || 12}{h >= 12 ? 'p' : 'a'}</span></div>{/each}
      </div>
      {#each sources as s (s.id)}
        <div class="lane">
          {#each hours as h}<div class="line" style="top: {(h - START_HOUR) * HOUR_PX}px"></div>{/each}
          {#each laneEvents(s.id) as e (e.start + e.summary)}
            <div class="event" style={eventStyle(e)}><span class="s">{e.summary}</span></div>
          {/each}
          <NowLine pxPerHour={HOUR_PX} />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .lanes-view { display: flex; flex-direction: column; width: 100%; height: 100%; padding: 0.5rem; box-sizing: border-box; gap: 0.3rem; min-height: 0; }
  header .title { font-size: calc(0.9rem * var(--cosmos-font-scale, 1)); opacity: 0.85; }
  .empty { opacity: 0.55; font-size: 0.85rem; padding: 1rem; }
  .lane-heads, .all-day, .grid { display: grid; gap: 0; }
  .lh { display: flex; align-items: center; gap: 0.35rem; padding: 0.2rem 0.35rem; font-size: 0.75rem; border-left: 1px solid rgba(255,255,255,0.04); }
  .lh .dot { width: 0.55rem; height: 0.55rem; border-radius: 999px; }
  .all-day { border-top: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06); min-height: 1.4rem; }
  .all-day .gutter { font-size: 0.55rem; opacity: 0.4; padding: 0.2rem 0.3rem; text-transform: uppercase; }
  .all-day .ad { display: flex; flex-wrap: wrap; gap: 0.15rem; padding: 0.15rem; border-left: 1px solid rgba(255,255,255,0.04); }
  .chip { font-size: 0.65rem; padding: 0.05rem 0.35rem; border-radius: 999px; background: rgba(255,255,255,0.06); border-left: 2px solid var(--c); }
  .grid { flex: 1; overflow: hidden; min-height: 0; }
  .hours { position: relative; }
  .hours .hr { height: 36px; position: relative; }
  .hours .hr span { position: absolute; right: 0.2rem; top: -0.5em; font-size: 0.6rem; opacity: 0.5; }
  .lane { position: relative; border-left: 1px solid rgba(255,255,255,0.04); overflow: hidden; }
  .line { position: absolute; left: 0; right: 0; height: 1px; background: rgba(255,255,255,0.04); }
  .event { position: absolute; left: 0.1rem; right: 0.1rem; background: rgba(255,255,255,0.08); border-left: 2px solid var(--c); border-radius: 0.2rem; padding: 0.05rem 0.3rem; font-size: 0.65rem; line-height: 1.15; overflow: hidden; }
</style>
