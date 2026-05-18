import { describe, it, expect, vi } from 'vitest';
import type { Scene } from '../src/store/scenes.js';
import { buildSceneState } from '../src/scenes/assembler.js';
import type { CalendarData, CalendarEvent } from '../src/scenes/types.js';

const SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 };

function calendarScene(config: Record<string, unknown>): Scene {
  return {
    id: 's1',
    name: 'test',
    layout: { cols: 12, rows: 8, items: [] },
    background: { type: 'solid', color: '#000' },
    typography: { font_family: 'Inter', font_scale: 1 },
    defaultTransitionId: null,
    widgets: [
      {
        id: 'w1',
        kind: 'calendar',
        position: { col: 0, row: 0, w: 4, h: 4 },
        config,
      },
    ],
  } as Scene;
}

describe('assembler — calendar multi-source', () => {
  it('legacy single entity_id config still works (no sources array)', async () => {
    const resolver = vi.fn(async (): Promise<CalendarEvent[]> => [
      { summary: 'A', start: '2026-05-17T10:00:00Z', end: '2026-05-17T11:00:00Z', all_day: false },
    ]);
    const state = await buildSceneState(
      calendarScene({ entity_id: 'calendar.home' }),
      SAFE_AREA,
      { resolveCalendarEvents: resolver }
    );
    const data = state.widgets[0].data as CalendarData;
    expect(data.events).toHaveLength(1);
    expect(data.sources).toBeDefined();
    expect(data.sources).toHaveLength(1);
    expect(data.sources![0].entity_id).toBe('calendar.home');
    expect(resolver).toHaveBeenCalledWith('calendar.home', expect.any(Object));
    // Each event should be tagged with its source.
    expect(data.events[0].source_id).toBe('calendar.home');
    expect(data.events[0].color).toBeDefined();
  });

  it('aggregates events from multiple sources, tagging each with source_id + color', async () => {
    const resolver = vi.fn(async (entityId: string): Promise<CalendarEvent[]> => {
      if (entityId === 'calendar.work') {
        return [{ summary: 'Work', start: '2026-05-17T09:00:00Z', end: '2026-05-17T10:00:00Z', all_day: false }];
      }
      if (entityId === 'calendar.home') {
        return [{ summary: 'Home', start: '2026-05-17T18:00:00Z', end: '2026-05-17T19:00:00Z', all_day: false }];
      }
      return [];
    });
    const state = await buildSceneState(
      calendarScene({
        sources: [
          { id: 'work', entity_id: 'calendar.work', label: 'Work', color: '#ff0000' },
          { id: 'home', entity_id: 'calendar.home', label: 'Home', color: '#00ff00' },
        ],
      }),
      SAFE_AREA,
      { resolveCalendarEvents: resolver }
    );
    const data = state.widgets[0].data as CalendarData;
    expect(data.events).toHaveLength(2);
    expect(data.sources).toHaveLength(2);
    const work = data.events.find((e) => e.summary === 'Work')!;
    const home = data.events.find((e) => e.summary === 'Home')!;
    expect(work.source_id).toBe('work');
    expect(work.color).toBe('#ff0000');
    expect(home.source_id).toBe('home');
    expect(home.color).toBe('#00ff00');
  });

  it('sorts events from all sources by start ASC', async () => {
    const resolver = vi.fn(async (entityId: string): Promise<CalendarEvent[]> => {
      if (entityId === 'calendar.a') {
        return [
          { summary: 'A-late', start: '2026-05-17T20:00:00Z', end: '2026-05-17T21:00:00Z', all_day: false },
          { summary: 'A-early', start: '2026-05-17T06:00:00Z', end: '2026-05-17T07:00:00Z', all_day: false },
        ];
      }
      if (entityId === 'calendar.b') {
        return [
          { summary: 'B-mid', start: '2026-05-17T12:00:00Z', end: '2026-05-17T13:00:00Z', all_day: false },
        ];
      }
      return [];
    });
    const state = await buildSceneState(
      calendarScene({
        sources: [
          { id: 'a', entity_id: 'calendar.a', label: 'A', color: '#aaa' },
          { id: 'b', entity_id: 'calendar.b', label: 'B', color: '#bbb' },
        ],
      }),
      SAFE_AREA,
      { resolveCalendarEvents: resolver }
    );
    const data = state.widgets[0].data as CalendarData;
    expect(data.events.map((e) => e.summary)).toEqual(['A-early', 'B-mid', 'A-late']);
  });

  it('a failing source does not break the others', async () => {
    const resolver = vi.fn(async (entityId: string): Promise<CalendarEvent[]> => {
      if (entityId === 'calendar.broken') {
        throw new Error('boom');
      }
      return [{ summary: 'Good', start: '2026-05-17T10:00:00Z', end: '2026-05-17T11:00:00Z', all_day: false }];
    });
    const state = await buildSceneState(
      calendarScene({
        sources: [
          { id: 'broken', entity_id: 'calendar.broken', label: 'Broken', color: '#f00' },
          { id: 'good', entity_id: 'calendar.good', label: 'Good', color: '#0f0' },
        ],
      }),
      SAFE_AREA,
      { resolveCalendarEvents: resolver }
    );
    const data = state.widgets[0].data as CalendarData;
    expect(data.events).toHaveLength(1);
    expect(data.events[0].summary).toBe('Good');
    expect(data.events[0].source_id).toBe('good');
    expect(data.sources).toHaveLength(2);
  });
});
