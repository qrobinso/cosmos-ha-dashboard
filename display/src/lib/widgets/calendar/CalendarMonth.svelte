<script lang="ts">
  import type { WidgetState, CalendarData, CalendarEvent } from '$lib/types';
  import { startOfWeek, addDays, dateKey, resolveColor } from './eventLayout';

  export let widget: WidgetState;
  $: data = widget.data as CalendarData | null;
  $: sources = data?.sources ?? [];

  $: anchor = new Date();
  $: monthStart = (() => { const d = new Date(anchor); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })();
  $: monthLabel = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $: gridStart = startOfWeek(monthStart, 0);
  $: cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  $: monthIdx = monthStart.getMonth();
  $: todayKey = dateKey(new Date());

  $: byDay = (() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of data?.events ?? []) {
      const s = new Date(e.start); s.setHours(0, 0, 0, 0);
      const eEnd = new Date(e.end);
      const exclusiveEnd = e.all_day ? eEnd : new Date(eEnd.getFullYear(), eEnd.getMonth(), eEnd.getDate() + 1);
      for (let d = new Date(s); d < exclusiveEnd; d.setDate(d.getDate() + 1)) {
        const k = dateKey(d);
        const arr = map.get(k) ?? [];
        arr.push(e);
        map.set(k, arr);
      }
    }
    return map;
  })();

  function fmtTime(iso: string): string {
    const d = new Date(iso);
    const h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = d.getHours() >= 12 ? 'p' : 'a';
    return `${h}:${m}${ampm}`;
  }
</script>

<div class="month">
  <header><span class="title">{monthLabel}</span></header>
  <div class="dow">
    {#each ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] as d}<span>{d}</span>{/each}
  </div>
  <div class="grid">
    {#each cells as d (d.toISOString())}
      {@const key = dateKey(d)}
      {@const inMonth = d.getMonth() === monthIdx}
      {@const evs = byDay.get(key) ?? []}
      <div class="cell" class:dim={!inMonth} class:today={key === todayKey}>
        <span class="num">{d.getDate()}</span>
        <ul class="evs">
          {#each evs.slice(0, 3) as e}
            <li class="ev" style="--c: {resolveColor(e, sources)}">
              <span class="dot"></span>
              <span class="lbl">{e.all_day ? '' : fmtTime(e.start) + ' '}{e.summary}</span>
            </li>
          {/each}
          {#if evs.length > 3}<li class="more">+{evs.length - 3} more</li>{/if}
        </ul>
      </div>
    {/each}
  </div>
</div>

<style>
  .month { display: flex; flex-direction: column; width: 100%; height: 100%; padding: 0.6rem; box-sizing: border-box; gap: 0.4rem; }
  header { display: flex; justify-content: space-between; align-items: baseline; }
  .title { font-size: calc(1rem * var(--cosmos-font-scale, 1)); opacity: 0.85; }
  .dow { display: grid; grid-template-columns: repeat(7, 1fr); font-size: 0.7rem; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.1em; }
  .dow span { padding: 0.15rem 0.35rem; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); grid-auto-rows: 1fr; gap: 1px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.06); border-radius: 0.4rem; overflow: hidden; min-height: 0; }
  .cell { background: rgba(0,0,0,0.18); padding: 0.25rem 0.35rem; display: flex; flex-direction: column; gap: 0.15rem; min-height: 0; overflow: hidden; }
  .cell.dim { opacity: 0.4; }
  .cell.today .num { background: var(--cosmos-fg, #fff); color: var(--cosmos-bg, #000); border-radius: 999px; padding: 0 0.4em; }
  .num { font-size: 0.75rem; opacity: 0.85; align-self: flex-start; }
  .evs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.1rem; min-height: 0; overflow: hidden; }
  .ev { display: flex; align-items: center; gap: 0.3rem; font-size: 0.7rem; line-height: 1.15; overflow: hidden; }
  .dot { width: 0.45rem; height: 0.45rem; border-radius: 999px; background: var(--c); flex: 0 0 auto; }
  .lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .more { font-size: 0.65rem; opacity: 0.55; }
</style>
