<script lang="ts">
  import type { WidgetState, CalendarData, CalendarEvent } from '$lib/types';

  export let widget: WidgetState;

  $: data = widget.data as CalendarData | null;
  $: cfg = widget.config as Record<string, unknown>;

  $: maxEvents = typeof cfg.max_events === 'number' ? cfg.max_events : 5;
  $: showAllDay = cfg.show_all_day !== false;
  $: showLocation = cfg.show_location !== false;
  $: showDescription = cfg.show_description === true;
  $: showHeader = cfg.show_header !== false;
  $: timeFormat = (cfg.time_format === '12h' ? '12h' : '24h') as '12h' | '24h';
  $: groupByDay = cfg.group_by_day !== false;
  $: hidePast = cfg.hide_past !== false;

  function fmtTime(iso: string): string {
    const d = new Date(iso);
    if (timeFormat === '12h') {
      const h = d.getHours() % 12 || 12;
      const m = String(d.getMinutes()).padStart(2, '0');
      const ampm = d.getHours() >= 12 ? 'pm' : 'am';
      return `${h}:${m}${ampm}`;
    }
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function dayLabel(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function dateKey(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  type Group = { label: string; events: CalendarEvent[] };

  $: filtered = (data?.events ?? [])
    .filter((e) => (showAllDay ? true : !e.all_day))
    .filter((e) => (hidePast ? new Date(e.end).getTime() > Date.now() : true))
    .slice(0, maxEvents);

  $: groups = (() => {
    if (!groupByDay) return [{ label: '', events: filtered }];
    const out: Group[] = [];
    let currentKey = '';
    for (const e of filtered) {
      const key = dateKey(e.start);
      if (key !== currentKey) {
        out.push({ label: dayLabel(e.start), events: [] });
        currentKey = key;
      }
      out[out.length - 1].events.push(e);
    }
    return out;
  })();
</script>

<div class="calendar">
  {#if showHeader}
    <header>
      <span class="title">{data?.friendly_name ?? 'Calendar'}</span>
      <span class="count">{filtered.length}</span>
    </header>
  {/if}
  {#if filtered.length === 0}
    <div class="empty">Nothing scheduled.</div>
  {:else}
    <ul class="agenda">
      {#each groups as group, gi (gi)}
        {#if groupByDay && group.label}
          <li class="day">{group.label}</li>
        {/if}
        {#each group.events as e (e.start + e.summary)}
          <li class="event">
            <span class="time" class:all-day={e.all_day}>
              {#if e.all_day}all day{:else}{fmtTime(e.start)}{/if}
            </span>
            <span class="body">
              <span class="summary">{e.summary}</span>
              {#if showLocation && e.location}
                <span class="meta">{e.location}</span>
              {/if}
              {#if showDescription && e.description}
                <span class="desc">{e.description}</span>
              {/if}
            </span>
          </li>
        {/each}
      {/each}
    </ul>
  {/if}
</div>

<style>
  .calendar {
    --gap: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    width: 100%;
    height: 100%;
    padding: 1rem;
    box-sizing: border-box;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .title {
    font-size: calc(0.95rem * var(--cosmos-font-scale, 1));
    opacity: 0.85;
    text-transform: capitalize;
  }
  .count {
    font-size: 0.7rem;
    opacity: 0.55;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }
  .empty {
    opacity: 0.6;
    font-size: 0.95rem;
    margin-top: 0.4rem;
  }
  .agenda {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    overflow: hidden;
    min-height: 0;
  }
  .day {
    font-size: calc(0.7rem * var(--cosmos-font-scale, 1));
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.55;
    margin-top: 0.45rem;
  }
  .day:first-child { margin-top: 0; }
  .event {
    display: grid;
    grid-template-columns: 4.25rem 1fr;
    gap: 0.7rem;
    align-items: baseline;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    line-height: 1.25;
  }
  .event:last-child { border-bottom: 0; }
  .time {
    font-variant-numeric: tabular-nums;
    font-size: calc(0.85rem * var(--cosmos-font-scale, 1));
    opacity: 0.7;
  }
  .time.all-day {
    text-transform: uppercase;
    font-size: calc(0.65rem * var(--cosmos-font-scale, 1));
    letter-spacing: 0.1em;
    opacity: 0.55;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .summary {
    font-size: calc(0.95rem * var(--cosmos-font-scale, 1));
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: calc(0.78rem * var(--cosmos-font-scale, 1));
    opacity: 0.65;
  }
  .desc {
    font-size: calc(0.78rem * var(--cosmos-font-scale, 1));
    opacity: 0.55;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
