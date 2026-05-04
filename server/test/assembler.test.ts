import { describe, it, expect } from 'vitest';
import type { Scene } from '../src/store/scenes.js';
import { buildSceneState, assemblePush } from '../src/scenes/assembler.js';
import { DEFAULT_SAFE_AREA } from '../src/api/http.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';

const baseScene: Scene = {
  id: 'scene-1',
  name: 'Test',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid', color: '#000' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  defaultTransitionId: null,
  widgets: [
    { id: 'w1', kind: 'clock', position: { col: 1, row: 1, w: 4, h: 2 }, config: {} },
    { id: 'w2', kind: 'weather', position: { col: 5, row: 1, w: 4, h: 2 }, config: { entity_id: 'weather.home' } },
    { id: 'w3', kind: 'entity_tile', position: { col: 9, row: 1, w: 4, h: 2 }, config: { entity_id: 'light.living_room' } },
    { id: 'w4', kind: 'entity_tile', position: { col: 1, row: 3, w: 4, h: 2 }, config: { entity_id: 'unknown.entity' } },
  ],
};

describe('buildSceneState', () => {
  it('passes scene metadata through unchanged including safe area', () => {
    const state = buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    expect(state.id).toBe('scene-1');
    expect(state.background).toEqual(baseScene.background);
    expect(state.typography).toEqual(baseScene.typography);
    expect(state.safeArea).toEqual(DEFAULT_SAFE_AREA);
  });

  it('attaches null data to clock widgets', () => {
    const state = buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    const clock = state.widgets.find((w) => w.kind === 'clock')!;
    expect(clock.data).toBeNull();
  });

  it('attaches mock weather data to weather widgets', () => {
    const state = buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    const weather = state.widgets.find((w) => w.kind === 'weather')!;
    expect(weather.data).toMatchObject({ current: { temp: 18 }, forecast: expect.any(Array) });
  });

  it('attaches mock entity state to entity_tile widgets and falls back for unknown entities', () => {
    const state = buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    const known = state.widgets.find((w) => w.id === 'w3')!;
    const unknown = state.widgets.find((w) => w.id === 'w4')!;
    expect((known.data as { state: string }).state).toBe('on');
    expect((unknown.data as { state: string }).state).toBe('unknown');
  });
});

function reposFor() {
  const db = new Database(':memory:');
  runMigrations(db);
  return { transitions: createTransitionsRepo(db), overrides: createOverridesRepo(db) };
}

describe('assemblePush', () => {
  it('omits transition when previousSceneId is null', () => {
    const { transitions, overrides } = reposFor();
    const payload = assemblePush({ scene: baseScene, safeArea: DEFAULT_SAFE_AREA, previousSceneId: null, transitions, overrides });
    expect(payload.transition).toBeUndefined();
  });

  it('omits transition when previous and new are the same scene', () => {
    const { transitions, overrides } = reposFor();
    const payload = assemblePush({ scene: baseScene, safeArea: DEFAULT_SAFE_AREA, previousSceneId: baseScene.id, transitions, overrides });
    expect(payload.transition).toBeUndefined();
  });

  it('uses scene.defaultTransitionId when no override exists', () => {
    const { transitions, overrides } = reposFor();
    const sceneWithDefault = { ...baseScene, id: 'scene-2', defaultTransitionId: 'builtin-cross-fade' };
    const payload = assemblePush({ scene: sceneWithDefault, safeArea: DEFAULT_SAFE_AREA, previousSceneId: 'scene-1', transitions, overrides });
    expect(payload.transition?.name).toBe('cross-fade');
  });

  it('uses overrides.get when a scene-pair override exists', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`).run('scene-1', 'A', '{}', '{}', '{}');
    db.prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`).run('scene-2', 'B', '{}', '{}', '{}');
    const transitions = createTransitionsRepo(db);
    const overrides = createOverridesRepo(db);
    overrides.set('scene-1', 'scene-2', 'builtin-dissolve');
    const sceneB = { ...baseScene, id: 'scene-2', defaultTransitionId: 'builtin-cross-fade' };
    const payload = assemblePush({ scene: sceneB, safeArea: DEFAULT_SAFE_AREA, previousSceneId: 'scene-1', transitions, overrides });
    expect(payload.transition?.name).toBe('dissolve');
  });

  it('explicitTransitionId takes precedence', () => {
    const { transitions, overrides } = reposFor();
    const sceneB = { ...baseScene, id: 'scene-2', defaultTransitionId: 'builtin-cross-fade' };
    const payload = assemblePush({
      scene: sceneB, safeArea: DEFAULT_SAFE_AREA, previousSceneId: 'scene-1',
      transitions, overrides, explicitTransitionId: 'builtin-slide-up',
    });
    expect(payload.transition?.name).toBe('slide-up');
  });
});
