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
    { id: 'w5', kind: 'camera', position: { col: 5, row: 3, w: 4, h: 3 }, config: { entity_id: 'camera.front_door', view: 'auto', refresh_interval_s: 10 } },
  ],
};

describe('buildSceneState', () => {
  it('passes scene metadata through unchanged including safe area', async () => {
    const state = await buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    expect(state.id).toBe('scene-1');
    expect(state.background).toEqual(baseScene.background);
    expect(state.typography).toEqual(baseScene.typography);
    expect(state.safeArea).toEqual(DEFAULT_SAFE_AREA);
  });

  it('attaches null data to clock widgets', async () => {
    const state = await buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    const clock = state.widgets.find((w) => w.kind === 'clock')!;
    expect(clock.data).toBeNull();
  });

  it('attaches mock weather data to weather widgets', async () => {
    const state = await buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    const weather = state.widgets.find((w) => w.kind === 'weather')!;
    expect(weather.data).toMatchObject({ current: { temp: 18 }, forecast: expect.any(Array) });
  });

  it('attaches mock entity state to entity_tile widgets and falls back for unknown entities', async () => {
    const state = await buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    const known = state.widgets.find((w) => w.id === 'w3')!;
    const unknown = state.widgets.find((w) => w.id === 'w4')!;
    expect((known.data as { state: string }).state).toBe('on');
    expect((unknown.data as { state: string }).state).toBe('unknown');
  });

  it('attaches CameraData to camera widgets with proxied snapshot + stream URLs', async () => {
    const state = await buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    const cam = state.widgets.find((w) => w.id === 'w5')!;
    expect(cam.data).toMatchObject({
      entity_id: 'camera.front_door',
      snapshot_url: '/api/ha-media/api/camera_proxy/camera.front_door',
      stream_url: '/api/ha-media/api/camera_proxy_stream/camera.front_door',
    });
    // Friendly name comes from mock entity attributes when available, falling
    // back to a humanized entity id otherwise.
    expect((cam.data as { friendly_name: string }).friendly_name).toBeTruthy();
  });

  it('omits resolvedMood when scene mood is disabled', async () => {
    const state = await buildSceneState(baseScene, DEFAULT_SAFE_AREA);
    expect(state.resolvedMood).toBeUndefined();
  });

  it('attaches resolvedMood when scene has an enabled manual mood', async () => {
    const sceneWithMood: Scene = {
      ...baseScene,
      mood: { enabled: true, strategy: 'manual', moodId: 'clouds' },
    };
    const state = await buildSceneState(sceneWithMood, DEFAULT_SAFE_AREA);
    expect(state.resolvedMood).toEqual({ url: '/moods/clouds.mp4', blend: 'screen', opacity: 1 });
  });

  it('passes the readEntitySync hook through to the mood resolver', async () => {
    const sceneWithMood: Scene = {
      ...baseScene,
      mood: { enabled: true, strategy: 'weather', weatherEntity: 'weather.home' },
    };
    const state = await buildSceneState(sceneWithMood, DEFAULT_SAFE_AREA, {
      readEntitySync: (id) =>
        id === 'weather.home'
          ? { entity_id: id, state: 'rainy', attributes: {} }
          : null,
    });
    expect(state.resolvedMood?.url).toBe('/moods/rain.mp4');
  });

  it('returns CanvasData with literal template marks when no canvasResolver is wired', async () => {
    const scene: Scene = {
      ...baseScene,
      widgets: [
        {
          id: 'c1',
          kind: 'canvas',
          position: { col: 1, row: 1, w: 4, h: 4 },
          config: { content: '<h1>{{ states("sensor.power") }}</h1>' },
        },
      ],
    } as Scene;
    const state = await buildSceneState(scene, { top: 0, right: 0, bottom: 0, left: 0 });
    const widget = state.widgets[0];
    expect(widget.kind).toBe('canvas');
    expect(widget.data).toEqual({ resolved: '<h1>{{ states("sensor.power") }}</h1>', liveEntityIds: [] });
  });

  it('uses the canvasResolver when provided', async () => {
    const scene: Scene = {
      ...baseScene,
      widgets: [
        {
          id: 'c2',
          kind: 'canvas',
          position: { col: 1, row: 1, w: 4, h: 4 },
          config: { content: '<h1>{{ states("x") }}</h1>' },
        },
      ],
    } as Scene;
    const state = await buildSceneState(scene, { top: 0, right: 0, bottom: 0, left: 0 }, {
      canvasResolver: async (_id, _content) => ({ resolved: '<h1>42</h1>', entityIds: ['x'] }),
    });
    expect(state.widgets[0].data).toEqual({ resolved: '<h1>42</h1>', liveEntityIds: ['x'] });
  });

  describe('adaptive_colors override', () => {
    const baseScene = {
      id: 's1',
      name: 'Test',
      layout: { cols: 12, rows: 8, items: [] as any[] },
      background: {
        type: 'gradient' as const,
        colors: ['#111111', '#222222', '#333333'],
        speed: 'medium' as const,
        style: 'mesh' as const,
        adaptive_colors: true,
      },
      typography: { font_family: 'Inter', font_scale: 1 },
      defaultTransitionId: null,
      floatWidgets: false,
      mood: { enabled: false, strategy: 'manual' as const },
      widgets: [],
    };

    it('overrides gradient.colors when adaptive_colors=true and palette non-empty', async () => {
      const state = await buildSceneState(baseScene, { top: 0, right: 0, bottom: 0, left: 0 }, undefined, undefined, new Map([['w1', ['#abcdef', '#fedcba']]]));
      expect(state.background.type).toBe('gradient');
      if (state.background.type !== 'gradient') return;
      // Two contribution colors + one pad from gradient.colors → 3 stops total.
      expect(state.background.colors).toHaveLength(3);
      expect(state.background.colors[0]).toBe('#abcdef');
      expect(state.background.colors[1]).toBe('#fedcba');
      expect(state.background.colors[2]).toBe('#111111');
    });

    it('keeps user colors when adaptive_colors=true but palette is empty', async () => {
      const state = await buildSceneState(baseScene, { top: 0, right: 0, bottom: 0, left: 0 }, undefined, undefined, new Map<string, string[]>());
      if (state.background.type !== 'gradient') return;
      expect(state.background.colors).toEqual(['#111111', '#222222', '#333333']);
    });

    it('keeps user colors when adaptive_colors=false even if palette supplied', async () => {
      const scene = { ...baseScene, background: { ...baseScene.background, adaptive_colors: false } };
      const state = await buildSceneState(scene, { top: 0, right: 0, bottom: 0, left: 0 }, undefined, undefined, new Map([['w1', ['#abcdef']]]));
      if (state.background.type !== 'gradient') return;
      expect(state.background.colors).toEqual(['#111111', '#222222', '#333333']);
    });

    it('pads with gradient.colors when adaptive palette is shorter than targetCount', async () => {
      const state = await buildSceneState(
        baseScene,
        { top: 0, right: 0, bottom: 0, left: 0 },
        undefined,
        undefined,
        new Map([['w1', ['#ff0000']]])  // single color
      );
      if (state.background.type !== 'gradient') return;
      // Must have 3 stops; first is the contribution, rest are padded from baseScene.colors.
      expect(state.background.colors).toHaveLength(3);
      expect(state.background.colors[0]).toBe('#ff0000');
      // Pads come from ['#111111', '#222222', '#333333']
      expect(state.background.colors).toContain('#111111');
    });
  });
});

function reposFor() {
  const db = new Database(':memory:');
  runMigrations(db);
  return { transitions: createTransitionsRepo(db), overrides: createOverridesRepo(db) };
}

describe('assemblePush', () => {
  it('omits transition when previousSceneId is null', async () => {
    const { transitions, overrides } = reposFor();
    const payload = await assemblePush({ scene: baseScene, safeArea: DEFAULT_SAFE_AREA, previousSceneId: null, transitions, overrides });
    expect(payload.transition).toBeUndefined();
  });

  it('omits transition when previous and new are the same scene', async () => {
    const { transitions, overrides } = reposFor();
    const payload = await assemblePush({ scene: baseScene, safeArea: DEFAULT_SAFE_AREA, previousSceneId: baseScene.id, transitions, overrides });
    expect(payload.transition).toBeUndefined();
  });

  it('uses scene.defaultTransitionId when no override exists', async () => {
    const { transitions, overrides } = reposFor();
    const sceneWithDefault = { ...baseScene, id: 'scene-2', defaultTransitionId: 'builtin-cross-fade' };
    const payload = await assemblePush({ scene: sceneWithDefault, safeArea: DEFAULT_SAFE_AREA, previousSceneId: 'scene-1', transitions, overrides });
    expect(payload.transition?.name).toBe('cross-fade');
  });

  it('uses overrides.get when a scene-pair override exists', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`).run('scene-1', 'A', '{}', '{}', '{}');
    db.prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`).run('scene-2', 'B', '{}', '{}', '{}');
    const transitions = createTransitionsRepo(db);
    const overrides = createOverridesRepo(db);
    overrides.set('scene-1', 'scene-2', 'builtin-dissolve');
    const sceneB = { ...baseScene, id: 'scene-2', defaultTransitionId: 'builtin-cross-fade' };
    const payload = await assemblePush({ scene: sceneB, safeArea: DEFAULT_SAFE_AREA, previousSceneId: 'scene-1', transitions, overrides });
    expect(payload.transition?.name).toBe('dissolve');
  });

  it('explicitTransitionId takes precedence', async () => {
    const { transitions, overrides } = reposFor();
    const sceneB = { ...baseScene, id: 'scene-2', defaultTransitionId: 'builtin-cross-fade' };
    const payload = await assemblePush({
      scene: sceneB, safeArea: DEFAULT_SAFE_AREA, previousSceneId: 'scene-1',
      transitions, overrides, explicitTransitionId: 'builtin-slide-up',
    });
    expect(payload.transition?.name).toBe('slide-up');
  });
});
