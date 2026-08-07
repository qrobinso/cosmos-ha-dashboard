# Calendar v2: Data Model + Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the calendar widget from a single-entity agenda list into a multi-calendar, multi-view (agenda / month / week / day / lanes) widget with per-source color coding and a now-line indicator on time-grid views.

**Architecture:**
1. **Server-side data model.** The calendar widget config grows from `{ entity_id }` to `{ sources: { id, entity_id, label, color }[] }`. The assembler fans out to N entities through the existing `calendarCache`, tags each event with `source_id` and `color`, and returns an aggregated `CalendarData` with a `sources` manifest.
2. **Backwards compatibility.** Old widget configs (single `entity_id`) are read transparently as a one-source widget. No migration of widget JSON; the assembler normalizes on read.
3. **Display-side views.** `Calendar.svelte` becomes a dispatcher that mounts one of `CalendarAgenda.svelte` / `CalendarMonth.svelte` / `CalendarWeek.svelte` / `CalendarDay.svelte` / `CalendarLanes.svelte` based on `config.view`. All five share `eventLayout.ts` helpers for day-bucketing, time positioning, and color resolution.
4. **TDD on the server, build-and-verify on the display** (per `display/CLAUDE.md`: no display test suite). Server gets new tests under `server/test/`; display work is verified via the existing kiosk preview + manual smoke at the end.

**Note on "people":** This plan intentionally does *not* introduce a household-people concept. The "lanes" view shows one column per *calendar source* instead. A first-class `people` model with assignment can come in a future plan if/when it earns its keep.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, SvelteKit + Svelte 4. No new runtime dependencies. No new server migrations.

---

## File Structure

**Server — create:**
- `server/test/calendar-multi-source.test.ts` — assembler multi-entity aggregation tests.

**Server — modify:**
- `server/src/scenes/types.ts:77-92` — extend `CalendarEvent` + `CalendarData`.
- `server/src/scenes/assembler.ts:196-222` — rewrite `calendarData()` to handle multi-source config.
- `server/src/scenes/mockData.ts:202-236` — leave mock event shape alone; assembler adds source attribution.
- `server/src/api/scenes.ts` — extend `validateWidget` to accept `sources` array on calendar widgets + validate the `view` enum.
- `display/src/lib/types.ts:61-73` — mirror server type changes.

**Display — create:**
- `display/src/lib/widgets/calendar/eventLayout.ts` — pure helpers (`bucketByDay`, `startOfWeek`, `minutesFromMidnight`, `overlapsRange`, `resolveColor`).
- `display/src/lib/widgets/calendar/CalendarAgenda.svelte` — extracted from today's `Calendar.svelte`.
- `display/src/lib/widgets/calendar/CalendarMonth.svelte` — 6-row × 7-col grid with event chips.
- `display/src/lib/widgets/calendar/CalendarWeek.svelte` — 7-col × hour-grid time view + all-day band + now-line.
- `display/src/lib/widgets/calendar/CalendarDay.svelte` — 1-col × hour-grid time view + all-day band + now-line.
- `display/src/lib/widgets/calendar/CalendarLanes.svelte` — N-col (per source) × hour-grid layout.
- `display/src/lib/widgets/calendar/NowLine.svelte` — single absolute-positioned line that re-renders every minute.

**Display — modify:**
- `display/src/lib/widgets/Calendar.svelte` — becomes a thin dispatcher on `config.view`.
- `display/src/lib/admin/widgets/CalendarConfig.svelte` — adds the view picker and multi-source editor with color swatches.
- `display/src/lib/admin/widgetKinds.ts` — update `defaultConfig` for `calendar` (provide one source, `view: 'agenda'`).

---

## Phase 1 — Server: Multi-source calendar assembly

### Task 1: Extend calendar types

**Files:**
- Modify: `server/src/scenes/types.ts:77-92`
- Modify: `display/src/lib/types.ts:61-73`

- [ ] **Step 1: Update server types**

Replace the `CalendarEvent` and `CalendarData` types:

```ts
export type CalendarEvent = {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  all_day: boolean;
  source_id?: string;
  color?: string;
};

export type CalendarSource = {
  id: string;
  entity_id: string;
  label: string;
  color: string;
};

export type CalendarData = {
  entity_id: string;
  friendly_name?: string;
  events: CalendarEvent[];
  sources: CalendarSource[];
};
```

- [ ] **Step 2: Mirror on the display side**

Apply the same changes verbatim to `display/src/lib/types.ts:61-73`.

- [ ] **Step 3: Type-check both workspaces**

Run: `npm --workspace server run build` and `npm --workspace display run check`

Expected: Builds succeed. Existing call sites that read `data.events` keep working; `data.sources` is additive.

- [ ] **Step 4: Commit**

```bash
git add server/src/scenes/types.ts display/src/lib/types.ts
git commit -m "feat(types): extend CalendarEvent with source/color, add CalendarSource[]"
```

### Task 2: Multi-source assembler

**Files:**
- Modify: `server/src/scenes/assembler.ts:196-222`
- Create: `server/test/calendar-multi-source.test.ts`

- [ ] **Step 1: Write failing aggregation tests**

Create `server/test/calendar-multi-source.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { assembleSceneState } from '../src/scenes/assembler.js';
import type { Scene, Widget } from '../src/scenes/types.js';

function calendarWidget(config: Record<string, unknown>): Widget {
  return {
    id: 'w1',
    kind: 'calendar',
    position: { col: 0, row: 0, w: 4, h: 4 },
    config,
  };
}

function scene(widget: Widget): Scene {
  return {
    id: 's1', name: 'test',
    layout: { cols: 12, rows: 8 },
    background: { kind: 'solid', value: '#000' },
    typography: { font_family: 'Inter', font_scale: 1 },
    widgets: [widget],
  };
}

describe('assembler — calendar multi-source', () => {
  it('legacy single entity_id config still works (no sources array)', async () => {
    const resolver = vi.fn(async () => [
      { summary: 'A', start: '2026-05-17T10:00:00Z', end: '2026-05-17T11:00:00Z', all_day: false },
    ]);
    const state = await assembleSceneState(scene(calendarWidget({ entity_id: 'calendar.home' })), {
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      resolveCalendarEvents: resolver,
      resolveEntity: async () => undefined,
    });
    const data = state.widgets[0].data as { events: unknown[]; sources: unknown[] };
    expect(data.events).toHaveLength(1);
    expect(data.sources).toHaveLength(1);
    expect(resolver).toHaveBeenCalledWith('calendar.home', expect.any(Object));
  });

  it('aggregates events across multiple sources and tags each with source_id + color', async () => {
    const resolver = vi.fn(async (eid: string) => {
      if (eid === 'calendar.alex')
        return [{ summary: 'A1', start: '2026-05-17T10:00:00Z', end: '2026-05-17T11:00:00Z', all_day: false }];
      if (eid === 'calendar.mira')
        return [{ summary: 'M1', start: '2026-05-17T09:00:00Z', end: '2026-05-17T09:30:00Z', all_day: false }];
      return [];
    });
    const widget = calendarWidget({
      sources: [
        { id: 'src-alex', entity_id: 'calendar.alex', label: 'Alex', color: '#ff8855' },
        { id: 'src-mira', entity_id: 'calendar.mira', label: 'Mira', color: '#0099ff' },
      ],
    });
    const state = await assembleSceneState(scene(widget), {
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      resolveCalendarEvents: resolver,
      resolveEntity: async () => undefined,
    });
    const data = state.widgets[0].data as { events: Array<Record<string, unknown>>; sources: unknown[] };
    expect(data.events).toHaveLength(2);
    expect(data.events.map((e) => e.summary).sort()).toEqual(['A1', 'M1']);
    const alex = data.events.find((e) => e.summary === 'A1')!;
    expect(alex.source_id).toBe('src-alex');
    expect(alex.color).toBe('#ff8855');
    expect(data.sources).toHaveLength(2);
  });

  it('events from all sources are sorted by start ASC', async () => {
    const resolver = vi.fn(async (eid: string) => {
      if (eid === 'calendar.a') return [{ summary: 'A', start: '2026-05-17T15:00:00Z', end: '2026-05-17T16:00:00Z', all_day: false }];
      return [{ summary: 'B', start: '2026-05-17T09:00:00Z', end: '2026-05-17T10:00:00Z', all_day: false }];
    });
    const widget = calendarWidget({
      sources: [
        { id: 's1', entity_id: 'calendar.a', label: 'A', color: '#fff' },
        { id: 's2', entity_id: 'calendar.b', label: 'B', color: '#000' },
      ],
    });
    const state = await assembleSceneState(scene(widget), {
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      resolveCalendarEvents: resolver,
      resolveEntity: async () => undefined,
    });
    const data = state.widgets[0].data as { events: Array<{ summary: string }> };
    expect(data.events.map((e) => e.summary)).toEqual(['B', 'A']);
  });

  it('a failing source does not break the others', async () => {
    const resolver = vi.fn(async (eid: string) => {
      if (eid === 'calendar.broken') throw new Error('boom');
      return [{ summary: 'ok', start: '2026-05-17T10:00:00Z', end: '2026-05-17T11:00:00Z', all_day: false }];
    });
    const widget = calendarWidget({
      sources: [
        { id: 'sb', entity_id: 'calendar.broken', label: 'Broken', color: '#f00' },
        { id: 'sg', entity_id: 'calendar.good', label: 'Good', color: '#0f0' },
      ],
    });
    const state = await assembleSceneState(scene(widget), {
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      resolveCalendarEvents: resolver,
      resolveEntity: async () => undefined,
    });
    const data = state.widgets[0].data as { events: Array<{ summary: string; source_id?: string }> };
    expect(data.events).toHaveLength(1);
    expect(data.events[0].summary).toBe('ok');
    expect(data.events[0].source_id).toBe('sg');
  });
});
```

*Note: the exact `assembleSceneState` signature and existing test helpers may differ — match the calling pattern used in `server/test/scenes-assembler.test.ts`. Adjust the wiring above to match what's already there before running.*

- [ ] **Step 2: Confirm tests fail**

Run: `npm --workspace server test -- calendar-multi-source`

Expected: FAIL — current assembler returns a single `entity_id` shape without `sources` or `source_id` tagging.

- [ ] **Step 3: Implement multi-source assembler**

Replace `calendarData()` in `server/src/scenes/assembler.ts:196-222` with:

```ts
type RawSource = { id?: unknown; entity_id?: unknown; label?: unknown; color?: unknown };

function normalizeSources(cfg: Record<string, unknown>): CalendarSource[] {
  const raw = cfg.sources;
  if (Array.isArray(raw)) {
    const out: CalendarSource[] = [];
    for (const s of raw as RawSource[]) {
      if (typeof s?.entity_id !== 'string' || !s.entity_id) continue;
      out.push({
        id: typeof s.id === 'string' && s.id ? s.id : s.entity_id,
        entity_id: s.entity_id,
        label: typeof s.label === 'string' && s.label
          ? s.label
          : s.entity_id.replace(/^calendar\./, '').replace(/_/g, ' '),
        color: typeof s.color === 'string' ? s.color : '#888888',
      });
    }
    if (out.length > 0) return out;
  }
  // Legacy single-entity fallback
  const entityId = readString(cfg, 'entity_id', 'calendar.home');
  return [{
    id: entityId,
    entity_id: entityId,
    label: entityId.replace(/^calendar\./, '').replace(/_/g, ' '),
    color: '#888888',
  }];
}

async function calendarData(widget: Widget, deps: DataResolvers): Promise<CalendarData> {
  const cfg = widget.config as Record<string, unknown>;
  const sources = normalizeSources(cfg);
  const daysAhead = readNumber(cfg, 'days_ahead', 2);
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(1, Math.min(60, daysAhead)));

  const perSource = await Promise.all(
    sources.map(async (src) => {
      if (!deps.resolveCalendarEvents) {
        return mockCalendar(src.entity_id).events.map((e) => ({
          ...e, source_id: src.id, color: src.color,
        }));
      }
      try {
        const events = await deps.resolveCalendarEvents(src.entity_id, { start, end });
        return events.map((e) => ({ ...e, source_id: src.id, color: src.color }));
      } catch {
        return [];
      }
    })
  );

  const events = perSource.flat().sort((a, b) => a.start.localeCompare(b.start));

  return {
    entity_id: sources[0].entity_id,
    friendly_name: sources.length === 1 ? sources[0].label : 'Calendar',
    events,
    sources,
  };
}
```

Update the imports at the top of `assembler.ts` to include `CalendarSource`.

- [ ] **Step 4: Run all server tests**

Run: `npm --workspace server test`

Expected: All tests pass — new multi-source tests + all existing calendar tests (legacy path still works).

- [ ] **Step 5: Commit**

```bash
git add server/src/scenes/assembler.ts server/test/calendar-multi-source.test.ts
git commit -m "feat(server): aggregate multi-source calendar events with source/color tagging"
```

### Task 3: API validation for sources array + view enum

**Files:**
- Modify: `server/src/api/scenes.ts` (inside `validateWidget`)
- Modify: existing scene-API test file (find under `server/test/`)

- [ ] **Step 1: Write failing API tests**

Open the existing `server/test/scenes-api.test.ts` (or whatever the scene-API test file is named) and add:

```ts
it('accepts a calendar widget with sources array', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/scenes',
    payload: {
      name: 'multi-cal',
      layout: { cols: 12, rows: 8 },
      background: { kind: 'solid', value: '#000' },
      typography: { font_family: 'Inter', font_scale: 1 },
      widgets: [{
        kind: 'calendar',
        position: { col: 0, row: 0, w: 4, h: 4 },
        config: {
          sources: [
            { id: 's1', entity_id: 'calendar.alex', label: 'Alex', color: '#ff8855' },
          ],
          view: 'agenda',
        },
      }],
    },
  });
  expect(res.statusCode).toBe(201);
});

it('rejects calendar sources with invalid entity_id', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/scenes',
    payload: {
      name: 'bad-cal',
      layout: { cols: 12, rows: 8 },
      background: { kind: 'solid', value: '#000' },
      typography: { font_family: 'Inter', font_scale: 1 },
      widgets: [{
        kind: 'calendar',
        position: { col: 0, row: 0, w: 4, h: 4 },
        config: { sources: [{ entity_id: 'not-a-calendar.entity' }] },
      }],
    },
  });
  expect(res.statusCode).toBe(400);
});

it('rejects unknown view value', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/scenes',
    payload: {
      name: 'bad-view',
      layout: { cols: 12, rows: 8 },
      background: { kind: 'solid', value: '#000' },
      typography: { font_family: 'Inter', font_scale: 1 },
      widgets: [{
        kind: 'calendar',
        position: { col: 0, row: 0, w: 4, h: 4 },
        config: { entity_id: 'calendar.home', view: 'galactic' },
      }],
    },
  });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run, confirm failures**

Run: `npm --workspace server test -- scenes-api`

Expected: The "bad" cases currently pass through (no validation), so they return 201 instead of 400 → tests fail.

- [ ] **Step 3: Extend `validateWidget`**

In `server/src/api/scenes.ts`, locate the calendar-kind branch in `validateWidget` (search for `'calendar'`) and add:

```ts
// inside validateWidget, calendar branch:
const cfg = (widget.config ?? {}) as Record<string, unknown>;
if (Array.isArray(cfg.sources)) {
  for (const s of cfg.sources as Array<Record<string, unknown>>) {
    if (typeof s?.entity_id !== 'string' || !/^calendar\.[a-z0-9_]+$/.test(s.entity_id)) {
      throw new ValidationError('calendar source has invalid entity_id');
    }
    if (s.color !== undefined && (typeof s.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.color))) {
      throw new ValidationError('calendar source color must be #RRGGBB');
    }
  }
} else if (typeof cfg.entity_id === 'string' && cfg.entity_id) {
  if (!/^calendar\.[a-z0-9_]+$/.test(cfg.entity_id)) {
    throw new ValidationError('calendar entity_id is malformed');
  }
}
const validViews = new Set(['agenda', 'month', 'week', 'day', 'lanes']);
if (cfg.view !== undefined && (typeof cfg.view !== 'string' || !validViews.has(cfg.view))) {
  throw new ValidationError('calendar view must be agenda|month|week|day|lanes');
}
```

*Adapt to the existing `validateWidget` style — it may use a different error mechanism than `ValidationError`. Match what's already in the file.*

- [ ] **Step 4: Run, confirm pass**

Run: `npm --workspace server test -- scenes-api`

Expected: All three new tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/scenes.ts server/test/scenes-api.test.ts
git commit -m "feat(server): validate calendar sources array and view enum"
```

---

## Phase 2 — Display: Multi-source calendar config UI

### Task 4: Calendar widget config — sources + view picker

**Files:**
- Modify: `display/src/lib/admin/widgets/CalendarConfig.svelte`
- Modify: `display/src/lib/admin/widgetKinds.ts` (update `calendar` default config)

- [ ] **Step 1: Update default config**

In `widgetKinds.ts`, change the calendar entry's `defaultConfig`:

```ts
defaultConfig: (entities) => ({
  view: 'agenda',
  sources: entities.filter((e) => e.entity_id.startsWith('calendar.')).slice(0, 1).map((e, i) => ({
    id: e.entity_id,
    entity_id: e.entity_id,
    label: e.entity_id.replace(/^calendar\./, '').replace(/_/g, ' '),
    color: ['#ff8855', '#0099ff', '#7ec46b', '#d96bf0', '#ffd166'][i % 5],
  })),
  days_ahead: 7,
  max_events: 8,
  show_header: true,
  show_all_day: true,
  show_location: true,
  group_by_day: true,
  hide_past: true,
  time_format: '24h',
}),
```

- [ ] **Step 2: Rewrite `CalendarConfig.svelte` source section + add view picker**

In `display/src/lib/admin/widgets/CalendarConfig.svelte`, replace the single `EntityPicker`-based source field with a multi-source editor and add a "View" field. Keep the legacy single-entity behavior: if `config.sources` is missing but `config.entity_id` is a string, lazily promote it into a one-element sources array on first edit.

The script block additions:

```svelte
<script lang="ts">
  // existing imports …

  const PALETTE = ['#ff8855', '#0099ff', '#7ec46b', '#d96bf0', '#ffd166', '#5fb8ff', '#ff6b9a', '#ffae5b'];

  type Source = { id: string; entity_id: string; label: string; color: string };

  function readSources(c: Record<string, unknown>): Source[] {
    if (Array.isArray(c.sources)) {
      return (c.sources as Array<Record<string, unknown>>)
        .filter((s) => typeof s.entity_id === 'string' && s.entity_id)
        .map((s, i) => ({
          id: typeof s.id === 'string' && s.id ? s.id : (s.entity_id as string),
          entity_id: s.entity_id as string,
          label: typeof s.label === 'string' && s.label
            ? (s.label as string)
            : (s.entity_id as string).replace(/^calendar\./, '').replace(/_/g, ' '),
          color: typeof s.color === 'string' ? (s.color as string) : PALETTE[i % PALETTE.length],
        }));
    }
    // Legacy promote
    if (typeof c.entity_id === 'string' && c.entity_id) {
      return [{ id: c.entity_id, entity_id: c.entity_id, label: c.entity_id.replace(/^calendar\./, '').replace(/_/g, ' '), color: PALETTE[0] }];
    }
    return [];
  }

  $: sources = readSources(config);
  $: view = (typeof config.view === 'string' ? config.view : 'agenda') as 'agenda' | 'month' | 'week' | 'day' | 'lanes';

  function commitSources(next: Source[]) {
    config = { ...config, sources: next };
    // Strip the legacy field once we've migrated to sources
    if ('entity_id' in config) {
      const { entity_id, ...rest } = config as Record<string, unknown>;
      config = rest;
    }
  }

  function updateSource(i: number, patch: Partial<Source>) {
    const next = sources.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    commitSources(next);
  }
  function addSource() {
    const next: Source = {
      id: `src-${Date.now()}`,
      entity_id: '',
      label: 'New calendar',
      color: PALETTE[sources.length % PALETTE.length],
    };
    commitSources([...sources, next]);
  }
  function removeSource(i: number) {
    commitSources(sources.filter((_, idx) => idx !== i));
  }
</script>
```

The replacement markup inside `<Section label="Source">`:

```svelte
<Field label="View">
  <select value={view} on:change={(e) => set('view', e.currentTarget.value)}>
    <option value="agenda">Agenda (list)</option>
    <option value="month">Month grid</option>
    <option value="week">Week (time grid)</option>
    <option value="day">Day (time grid)</option>
    <option value="lanes">Lanes (one column per calendar)</option>
  </select>
</Field>

<Field label="Calendars">
  {#each sources as src, i (src.id)}
    <div class="src-row">
      <input
        type="color"
        value={src.color}
        on:change={(e) => updateSource(i, { color: e.currentTarget.value })}
        aria-label="Color for {src.label}"
      />
      <EntityPicker
        value={src.entity_id}
        entities={calendarEntities}
        placeholder="Search calendars…"
        on:change={(e) => updateSource(i, { entity_id: e.detail, id: e.detail || src.id })}
      />
      <input
        class="lbl"
        value={src.label}
        placeholder="Label"
        on:change={(e) => updateSource(i, { label: e.currentTarget.value })}
      />
      <button type="button" class="remove" on:click={() => removeSource(i)} aria-label="Remove">×</button>
    </div>
  {/each}
  <button type="button" class="add" on:click={addSource}>+ Add calendar</button>
</Field>
```

And the style additions:

```css
.src-row { display: grid; grid-template-columns: 2.5rem 1fr 8rem 2rem; gap: 0.4rem; align-items: center; margin-bottom: 0.35rem; }
.src-row .lbl { font-size: 0.85rem; }
.src-row .remove { background: transparent; border: 1px solid var(--c-line); color: var(--c-fg-2); border-radius: 0.3rem; cursor: pointer; }
.add { background: transparent; border: 1px dashed var(--c-line); color: var(--c-fg-2); padding: 0.4rem 0.6rem; border-radius: 0.3rem; cursor: pointer; width: 100%; margin-top: 0.3rem; }
```

When the view is `'week'`, `'day'`, or `'lanes'`, hide the `max_events` field — it's agenda-specific. Wrap that field in `{#if view === 'agenda'}…{/if}`.

- [ ] **Step 3: Verify in the browser**

Run `npm run dev:server` + `npm run dev:display`. Add a calendar widget to a scene, then:
- Confirm it defaults to one source with a color swatch.
- Add a second source, set a different color, set a custom label.
- Switch view between agenda / month / week / day / lanes.
- Reload the scene editor and confirm the config round-trips.
- Open an *existing* legacy scene (one with just `entity_id`) and confirm it still loads, then save it and confirm the config got promoted to a `sources` array.

- [ ] **Step 4: Commit**

```bash
git add display/src/lib/admin/widgets/CalendarConfig.svelte display/src/lib/admin/widgetKinds.ts
git commit -m "feat(admin): multi-source calendar editor with view picker"
```

---

## Phase 3 — Display: View dispatcher + shared layout helpers

### Task 5: Extract layout helpers

**Files:**
- Create: `display/src/lib/widgets/calendar/eventLayout.ts`

- [ ] **Step 1: Write helpers**

Create `display/src/lib/widgets/calendar/eventLayout.ts`:

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npm --workspace display run check`

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add display/src/lib/widgets/calendar/eventLayout.ts
git commit -m "feat(display): shared calendar event-layout helpers"
```

### Task 6: Extract agenda view + add view dispatcher

**Files:**
- Create: `display/src/lib/widgets/calendar/CalendarAgenda.svelte`
- Create: `display/src/lib/widgets/calendar/CalendarMonth.svelte` (stub)
- Create: `display/src/lib/widgets/calendar/CalendarWeek.svelte` (stub)
- Create: `display/src/lib/widgets/calendar/CalendarDay.svelte` (stub)
- Create: `display/src/lib/widgets/calendar/CalendarLanes.svelte` (stub)
- Modify: `display/src/lib/widgets/Calendar.svelte` (becomes a dispatcher)

- [ ] **Step 1: Move agenda code**

Move the entire current contents of `display/src/lib/widgets/Calendar.svelte` (script + markup + styles) into `display/src/lib/widgets/calendar/CalendarAgenda.svelte`. Then add a colored left-border accent per event:

In the script:

```ts
import { resolveColor } from './eventLayout';
$: sources = data?.sources ?? [];
```

On the `<li class="event">` element:

```svelte
<li class="event" style="--event-color: {resolveColor(e, sources)}">
```

And in `<style>`:

```css
.event { border-left: 3px solid var(--event-color, transparent); padding-left: 0.6rem; }
```

- [ ] **Step 2: Stub the four new view components**

Create each of `CalendarMonth.svelte`, `CalendarWeek.svelte`, `CalendarDay.svelte`, `CalendarLanes.svelte` with:

```svelte
<script lang="ts">
  import type { WidgetState } from '$lib/types';
  export let widget: WidgetState;
</script>
<div class="placeholder">{(widget.config as Record<string, unknown>)?.view ?? 'view'} (coming next)</div>
<style>.placeholder { padding: 1rem; opacity: 0.6; font-size: 0.9rem; }</style>
```

- [ ] **Step 3: Replace `Calendar.svelte` with a dispatcher**

```svelte
<script lang="ts">
  import type { WidgetState } from '$lib/types';
  import CalendarAgenda from './calendar/CalendarAgenda.svelte';
  import CalendarMonth from './calendar/CalendarMonth.svelte';
  import CalendarWeek from './calendar/CalendarWeek.svelte';
  import CalendarDay from './calendar/CalendarDay.svelte';
  import CalendarLanes from './calendar/CalendarLanes.svelte';

  export let widget: WidgetState;
  $: view = (widget.config as Record<string, unknown>)?.view ?? 'agenda';
</script>

{#if view === 'month'}
  <CalendarMonth {widget} />
{:else if view === 'week'}
  <CalendarWeek {widget} />
{:else if view === 'day'}
  <CalendarDay {widget} />
{:else if view === 'lanes'}
  <CalendarLanes {widget} />
{:else}
  <CalendarAgenda {widget} />
{/if}
```

- [ ] **Step 4: Verify in the browser**

Open an existing scene with a calendar widget; confirm it still renders as agenda (now with colored left-border on events). Switch the view in the editor to month/week/day/lanes and confirm each placeholder shows up.

- [ ] **Step 5: Commit**

```bash
git add display/src/lib/widgets/Calendar.svelte display/src/lib/widgets/calendar/
git commit -m "refactor(display): split Calendar into agenda + view dispatcher with stubs"
```

---

## Phase 4 — Display: Month view

### Task 7: Month view

**Files:**
- Modify: `display/src/lib/widgets/calendar/CalendarMonth.svelte`

- [ ] **Step 1: Implement**

```svelte
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
```

- [ ] **Step 2: Verify**

Build a scene with a calendar widget set to month view across at least 3 sources with different colors. Confirm: today is highlighted, multi-day events span across cells, dots match source colors, off-month days are dimmed.

- [ ] **Step 3: Commit**

```bash
git add display/src/lib/widgets/calendar/CalendarMonth.svelte
git commit -m "feat(display): month calendar view with multi-source dot colors"
```

---

## Phase 5 — Display: Day + Week views + Now line

### Task 8: NowLine component

**Files:**
- Create: `display/src/lib/widgets/calendar/NowLine.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  export let pxPerHour: number;
  function currentMin(): number { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  let nowMin = currentMin();
  let timer: ReturnType<typeof setInterval>;
  onMount(() => { timer = setInterval(() => { nowMin = currentMin(); }, 60_000); });
  onDestroy(() => clearInterval(timer));
  $: top = (nowMin / 60) * pxPerHour;
</script>
<div class="now" style="top: {top}px">
  <span class="dot"></span>
</div>
<style>
  .now { position: absolute; left: 0; right: 0; height: 0; border-top: 1.5px solid var(--c-accent, #ff6a3d); pointer-events: none; z-index: 5; }
  .dot { position: absolute; left: -4px; top: -4.5px; width: 8px; height: 8px; border-radius: 999px; background: var(--c-accent, #ff6a3d); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add display/src/lib/widgets/calendar/NowLine.svelte
git commit -m "feat(display): NowLine indicator (updates every minute)"
```

### Task 9: Day view

**Files:**
- Modify: `display/src/lib/widgets/calendar/CalendarDay.svelte`

- [ ] **Step 1: Implement**

```svelte
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
```

- [ ] **Step 2: Verify**

Render in a tall (≥ 4-row) calendar widget; confirm hour gridlines, event rectangles colored by source, all-day band at top, and the now-line indicator appears at the correct vertical position (within a minute of system clock).

- [ ] **Step 3: Commit**

```bash
git add display/src/lib/widgets/calendar/CalendarDay.svelte
git commit -m "feat(display): day calendar view with time grid, all-day band, and now-line"
```

### Task 10: Week view

**Files:**
- Modify: `display/src/lib/widgets/calendar/CalendarWeek.svelte`

- [ ] **Step 1: Implement**

```svelte
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
```

- [ ] **Step 2: Verify**

Confirm: 7 columns from Sunday, today's column highlighted, hour labels on gutter, events colored, all-day band spans correct columns for multi-day events, now-line only in today's column.

- [ ] **Step 3: Commit**

```bash
git add display/src/lib/widgets/calendar/CalendarWeek.svelte
git commit -m "feat(display): week calendar view with all-day band and per-column now-line"
```

---

## Phase 6 — Display: Lanes (per-calendar swim-lane) view

### Task 11: Lanes view

**Files:**
- Modify: `display/src/lib/widgets/calendar/CalendarLanes.svelte`

The Lanes view is a single-day time grid with one column per *calendar source*. Each event lands in the column matching its `source_id`.

- [ ] **Step 1: Implement**

```svelte
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
```

- [ ] **Step 2: Verify**

Configure a calendar widget with 2–3 sources, each a different calendar entity + color. Switch to lanes view. Confirm: one column per source labeled with its name + color dot, events appear in their assigned lane (matching `source_id`), now-line spans all lanes.

- [ ] **Step 3: Commit**

```bash
git add display/src/lib/widgets/calendar/CalendarLanes.svelte
git commit -m "feat(display): per-source swim-lane calendar view"
```

---

## Phase 7 — Smoke + docs

### Task 12: End-to-end smoke

**Files:**
- N/A (manual + ad-hoc verification)

- [ ] **Step 1: Full server test pass**

Run: `npm --workspace server test`

Expected: all green.

- [ ] **Step 2: Display type check + build**

Run: `npm --workspace display run check && npm --workspace display run build`

Expected: both succeed.

- [ ] **Step 3: Manual smoke**

Start `npm run dev:server` and `npm run dev:display`. Walk through:
1. Open an *existing* scene with a legacy single-entity calendar widget; confirm it still renders (agenda + colored border). Save it and confirm the editor promoted it to a `sources` array.
2. New scene → add calendar widget → defaults to one source/agenda.
3. Add three sources with different entities + colors.
4. Cycle the view through agenda / month / week / day / lanes; confirm each renders correctly.
5. Reload — config persists. Open `/admin/scenes/<id>/preview` and confirm preview matches.
6. Disable the HA connection (or run with no `HA_URL`) and confirm mock events still flow through and each gets the configured source color.

- [ ] **Step 4: Commit any tweaks discovered during smoke**

Use one commit per logical fix.

### Task 13: Update CLAUDE.md notes

**Files:**
- Modify: root `CLAUDE.md`

- [ ] **Step 1: Update tech-debt and roadmap notes**

In root `CLAUDE.md`, under "Known tech debt", remove or update any calendar-specific items that this plan resolved (e.g., per-calendar colors). Add anything discovered during smoke (e.g., "Calendar `view` and `sources` are now persisted, but the editor doesn't yet expose week-start-day or hour range — hardcoded to Sun start, 6am–11pm window. Tighten when a user actually asks.").

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note calendar v2 multi-source views"
```

---

## Self-review notes

- **Spec coverage:**
  - T1.1 month/week/day = Tasks 7/9/10
  - T1.2 multi-cal aggregation = Task 2
  - T1.3 per-cal colors = Tasks 2/4 (config) + each view renders them
  - T1.4 profiles = **dropped per user direction**
  - T1.5 reminders = **deferred to Plan B**
  - T1.7 now-line = Tasks 8–10
  - T2.1 swim-lane = Task 11 (one column per *calendar source*, not per person)
  - T2.3 offline cache = **deferred to Plan C**
- **Backwards compatibility:** legacy `entity_id` configs flow through `normalizeSources()` (Task 2) and `CalendarConfig.svelte`'s lazy promotion (Task 4). Existing scenes keep working; first edit migrates them.
- **Type consistency:** `CalendarSource.id`, `CalendarEvent.source_id`, `CalendarEvent.color` are introduced in Task 1 and used identically in every later task.
- **Performance:** Multi-source fan-out parallelizes via `Promise.all` (Task 2) and reuses the existing `calendarCache` (5-min TTL, request-coalesced).
- **Reactive re-push:** unchanged from today — Plan A doesn't add a refresh timer. The existing "calendars don't reactively re-push on event mutation" tech debt remains (carry into Plan B/D).