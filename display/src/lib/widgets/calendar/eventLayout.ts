import type { CalendarEvent, CalendarSource } from '$lib/types';

export type DayBucket = { dateKey: string; date: Date; allDay: CalendarEvent[]; timed: CalendarEvent[] };

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function startOfWeek(d: Date, firstDay: 0 | 1 = 0): Date {
  const c = startOfDay(d);
  const day = c.getDay();
  const diff = (day - firstDay + 7) % 7;
  c.setDate(c.getDate() - diff);
  return c;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function minutesFromMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function overlapsRange(event: CalendarEvent, start: Date, end: Date): boolean {
  const es = new Date(event.start).getTime();
  const ee = new Date(event.end).getTime();
  return ee > start.getTime() && es < end.getTime();
}

export function bucketByDay(events: CalendarEvent[], days: Date[]): DayBucket[] {
  const out: DayBucket[] = days.map((d) => ({ dateKey: dateKey(d), date: d, allDay: [], timed: [] }));
  for (const e of events) {
    const start = startOfDay(new Date(e.start));
    const endExclusive = e.all_day ? new Date(e.end) : startOfDay(new Date(e.end));
    for (const bucket of out) {
      if (bucket.date >= start && bucket.date < endExclusive) {
        (e.all_day ? bucket.allDay : bucket.timed).push(e);
      } else if (!e.all_day && bucket.dateKey === dateKey(new Date(e.start))) {
        bucket.timed.push(e);
      }
    }
  }
  return out;
}

export function resolveColor(event: CalendarEvent, sources: CalendarSource[]): string {
  if (event.color) return event.color;
  const src = sources.find((s) => s.id === event.source_id);
  return src?.color ?? 'var(--cosmos-fg, #ffffff)';
}
