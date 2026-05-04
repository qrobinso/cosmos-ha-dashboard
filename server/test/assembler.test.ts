import { describe, it, expect } from 'vitest';
import type { Scene } from '../src/store/scenes.js';
import { buildSceneState } from '../src/scenes/assembler.js';

const baseScene: Scene = {
  id: 'scene-1',
  name: 'Test',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid', color: '#000' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { id: 'w1', kind: 'clock', position: { col: 1, row: 1, w: 4, h: 2 }, config: {} },
    { id: 'w2', kind: 'weather', position: { col: 5, row: 1, w: 4, h: 2 }, config: { entity_id: 'weather.home' } },
    { id: 'w3', kind: 'entity_tile', position: { col: 9, row: 1, w: 4, h: 2 }, config: { entity_id: 'light.living_room' } },
    { id: 'w4', kind: 'entity_tile', position: { col: 1, row: 3, w: 4, h: 2 }, config: { entity_id: 'unknown.entity' } },
  ],
};

describe('buildSceneState', () => {
  it('passes scene metadata through unchanged', () => {
    const state = buildSceneState(baseScene);
    expect(state.id).toBe('scene-1');
    expect(state.background).toEqual(baseScene.background);
    expect(state.typography).toEqual(baseScene.typography);
  });

  it('attaches null data to clock widgets', () => {
    const state = buildSceneState(baseScene);
    const clock = state.widgets.find((w) => w.kind === 'clock')!;
    expect(clock.data).toBeNull();
  });

  it('attaches mock weather data to weather widgets', () => {
    const state = buildSceneState(baseScene);
    const weather = state.widgets.find((w) => w.kind === 'weather')!;
    expect(weather.data).toMatchObject({ current: { temp: 18 }, forecast: expect.any(Array) });
  });

  it('attaches mock entity state to entity_tile widgets and falls back for unknown entities', () => {
    const state = buildSceneState(baseScene);
    const known = state.widgets.find((w) => w.id === 'w3')!;
    const unknown = state.widgets.find((w) => w.id === 'w4')!;
    expect((known.data as { state: string }).state).toBe('on');
    expect((unknown.data as { state: string }).state).toBe('unknown');
  });
});
