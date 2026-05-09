import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createScenesRepo, type SceneInput } from '../src/store/scenes.js';
import { createCanvasExtrasStore } from '../src/api/canvases.js';
import { createInterestSet } from '../src/scenes/interest.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const scenes = createScenesRepo(db);
  const canvasExtras = createCanvasExtrasStore();
  const interest = createInterestSet({ displays, scenes, canvasExtras });
  return { db, displays, scenes, canvasExtras, interest };
}

function baseSceneInput(overrides: Partial<SceneInput> = {}): SceneInput {
  return {
    name: 'S',
    layout: { cols: 12, rows: 8, items: [] },
    background: { type: 'solid', color: '#101010' },
    typography: { font_family: 'Inter', font_scale: 1.0 },
    widgets: [],
    ...overrides,
  };
}

describe('createInterestSet', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('is empty when no displays exist', () => {
    ctx.interest.recompute();
    expect(ctx.interest.size()).toBe(0);
    expect(ctx.interest.has('sun.sun')).toBe(false);
  });

  it('is empty when displays exist but have no active scene', () => {
    ctx.displays.registerByName('kitchen');
    ctx.interest.recompute();
    expect(ctx.interest.size()).toBe(0);
  });

  it('includes widget entity_ids from each active scene', () => {
    const sceneA = ctx.scenes.create(
      baseSceneInput({
        name: 'A',
        widgets: [
          { kind: 'entity_tile', position: { col: 1, row: 1, w: 2, h: 2 }, config: { entity_id: 'light.kitchen' } },
        ],
      })
    );
    const sceneB = ctx.scenes.create(
      baseSceneInput({
        name: 'B',
        widgets: [
          { kind: 'weather', position: { col: 1, row: 1, w: 4, h: 3 }, config: { entity_id: 'weather.home' } },
        ],
      })
    );
    const d1 = ctx.displays.registerByName('a-display');
    const d2 = ctx.displays.registerByName('b-display');
    ctx.displays.setCurrentScene(d1.id, sceneA.id);
    ctx.displays.setCurrentScene(d2.id, sceneB.id);
    ctx.interest.recompute();
    expect(ctx.interest.has('light.kitchen')).toBe(true);
    expect(ctx.interest.has('weather.home')).toBe(true);
    expect(ctx.interest.size()).toBe(2);
  });

  it('includes sun.sun for active scenes with mood.strategy = time', () => {
    const scene = ctx.scenes.create(
      baseSceneInput({
        mood: { enabled: true, strategy: 'time', moodId: undefined, weatherEntity: undefined, opacity: 1 },
      })
    );
    const d = ctx.displays.registerByName('d');
    ctx.displays.setCurrentScene(d.id, scene.id);
    ctx.interest.recompute();
    expect(ctx.interest.has('sun.sun')).toBe(true);
  });

  it('includes sun.sun for active gradient scenes with sun_adaptive', () => {
    const scene = ctx.scenes.create(
      baseSceneInput({
        background: {
          type: 'gradient',
          colors: ['#000', '#111'],
          speed: 'medium',
          style: 'mesh',
          sun_adaptive: true,
        },
      })
    );
    const d = ctx.displays.registerByName('d');
    ctx.displays.setCurrentScene(d.id, scene.id);
    ctx.interest.recompute();
    expect(ctx.interest.has('sun.sun')).toBe(true);
  });

  it('includes the configured weather entity for mood.strategy = weather', () => {
    const scene = ctx.scenes.create(
      baseSceneInput({
        mood: {
          enabled: true,
          strategy: 'weather',
          moodId: undefined,
          weatherEntity: 'weather.backyard',
          opacity: 1,
        },
      })
    );
    const d = ctx.displays.registerByName('d');
    ctx.displays.setCurrentScene(d.id, scene.id);
    ctx.interest.recompute();
    expect(ctx.interest.has('weather.backyard')).toBe(true);
  });

  it('includes canvas-extras entities only when the active scene contains a canvas widget', () => {
    const canvasScene = ctx.scenes.create(
      baseSceneInput({
        name: 'canvas-scene',
        widgets: [
          { id: 'w-canvas', kind: 'canvas', position: { col: 1, row: 1, w: 4, h: 4 }, config: {} },
        ],
      })
    );
    const noCanvasScene = ctx.scenes.create(
      baseSceneInput({
        name: 'no-canvas-scene',
        widgets: [
          { kind: 'clock', position: { col: 1, row: 1, w: 2, h: 2 }, config: {} },
        ],
      })
    );

    const d1 = ctx.displays.registerByName('d1');
    const d2 = ctx.displays.registerByName('d2');
    ctx.canvasExtras.add('d1', 'w-canvas', ['sensor.dynamic']);
    ctx.canvasExtras.add('d2', 'some-widget', ['sensor.other']);

    ctx.displays.setCurrentScene(d1.id, canvasScene.id);
    ctx.displays.setCurrentScene(d2.id, noCanvasScene.id);
    ctx.interest.recompute();

    expect(ctx.interest.has('sensor.dynamic')).toBe(true);
    expect(ctx.interest.has('sensor.other')).toBe(false);
  });

  it('does NOT include entities from non-active scenes', () => {
    const inactive = ctx.scenes.create(
      baseSceneInput({
        name: 'inactive',
        widgets: [
          { kind: 'entity_tile', position: { col: 1, row: 1, w: 2, h: 2 }, config: { entity_id: 'light.never' } },
        ],
      })
    );
    const active = ctx.scenes.create(
      baseSceneInput({
        name: 'active',
        widgets: [
          { kind: 'entity_tile', position: { col: 1, row: 1, w: 2, h: 2 }, config: { entity_id: 'light.always' } },
        ],
      })
    );
    const d = ctx.displays.registerByName('d');
    ctx.displays.setCurrentScene(d.id, active.id);
    ctx.interest.recompute();
    expect(ctx.interest.has('light.always')).toBe(true);
    expect(ctx.interest.has('light.never')).toBe(false);
    // sanity: scene exists but isn't surfaced
    expect(ctx.scenes.get(inactive.id)).not.toBeNull();
  });

  it('reflects updates after recompute() following display/scene/canvas-extras changes', () => {
    const scene = ctx.scenes.create(
      baseSceneInput({
        widgets: [
          { id: 'w-canvas', kind: 'canvas', position: { col: 1, row: 1, w: 4, h: 4 }, config: {} },
        ],
      })
    );
    ctx.interest.recompute();
    expect(ctx.interest.size()).toBe(0);

    const d = ctx.displays.registerByName('d');
    ctx.displays.setCurrentScene(d.id, scene.id);
    ctx.interest.recompute();
    expect(ctx.interest.size()).toBe(0);

    ctx.canvasExtras.add('d', 'w-canvas', ['sensor.live']);
    ctx.interest.recompute();
    expect(ctx.interest.has('sensor.live')).toBe(true);

    ctx.canvasExtras.clearDisplay('d');
    ctx.interest.recompute();
    expect(ctx.interest.has('sensor.live')).toBe(false);

    ctx.scenes.update(scene.id, baseSceneInput({
      widgets: [
        { kind: 'entity_tile', position: { col: 1, row: 1, w: 2, h: 2 }, config: { entity_id: 'light.new' } },
      ],
    }));
    ctx.interest.recompute();
    expect(ctx.interest.has('light.new')).toBe(true);
  });
});
