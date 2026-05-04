import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createScenesRepo, type SceneInput } from '../src/store/scenes.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return {
    scenes: createScenesRepo(db),
    displays: createDisplaysRepo(db),
  };
}

const sample: SceneInput = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid', color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { kind: 'clock', position: { col: 1, row: 1, w: 6, h: 2 }, config: { format: '24h' } },
  ],
};

describe('scenes repo', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('create returns a scene with id and embedded widgets', () => {
    const s = ctx.scenes.create(sample);
    expect(s.id).toMatch(/^[a-z0-9-]{8,}$/);
    expect(s.name).toBe('Morning');
    expect(s.background.type).toBe('solid');
    expect(s.widgets.length).toBe(1);
    expect(s.widgets[0].kind).toBe('clock');
  });

  it('get returns the scene with widgets', () => {
    const created = ctx.scenes.create(sample);
    const fetched = ctx.scenes.get(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.widgets.length).toBe(1);
  });

  it('list returns all scenes', () => {
    ctx.scenes.create({ ...sample, name: 'A' });
    ctx.scenes.create({ ...sample, name: 'B' });
    expect(ctx.scenes.list().map((s) => s.name).sort()).toEqual(['A', 'B']);
  });

  it('update replaces fields and widgets', () => {
    const s = ctx.scenes.create(sample);
    const updated = ctx.scenes.update(s.id, {
      ...sample,
      name: 'Morning v2',
      widgets: [
        { kind: 'weather', position: { col: 1, row: 1, w: 4, h: 3 }, config: { entity_id: 'weather.home' } },
      ],
    });
    expect(updated.name).toBe('Morning v2');
    expect(updated.widgets.length).toBe(1);
    expect(updated.widgets[0].kind).toBe('weather');
  });

  it('delete removes the scene and its widgets', () => {
    const s = ctx.scenes.create(sample);
    ctx.scenes.delete(s.id);
    expect(ctx.scenes.get(s.id)).toBeNull();
  });

  it('assignToDisplay links a scene to a display', () => {
    const s = ctx.scenes.create(sample);
    const d = ctx.displays.registerByName('Living Room');
    ctx.scenes.assignToDisplay(s.id, d.id);
    expect(ctx.scenes.listAssignedTo(d.id).map((x) => x.id)).toEqual([s.id]);
  });

  it('unassignFromDisplay removes the link', () => {
    const s = ctx.scenes.create(sample);
    const d = ctx.displays.registerByName('Kitchen');
    ctx.scenes.assignToDisplay(s.id, d.id);
    ctx.scenes.unassignFromDisplay(s.id, d.id);
    expect(ctx.scenes.listAssignedTo(d.id)).toEqual([]);
  });

  it('create + update accept and persist default_transition_id', () => {
    const ctx = setup();
    const created = ctx.scenes.create({ ...sample, defaultTransitionId: 'builtin-cross-fade' });
    expect(created.defaultTransitionId).toBe('builtin-cross-fade');
    const fetched = ctx.scenes.get(created.id);
    expect(fetched?.defaultTransitionId).toBe('builtin-cross-fade');
    const updated = ctx.scenes.update(created.id, { ...sample, defaultTransitionId: 'builtin-dissolve' });
    expect(updated.defaultTransitionId).toBe('builtin-dissolve');
  });

  it('default_transition_id is null when not provided', () => {
    const ctx = setup();
    const created = ctx.scenes.create(sample);
    expect(created.defaultTransitionId).toBeNull();
  });

  it('getByName returns the scene or null', () => {
    const ctx = setup();
    const created = ctx.scenes.create({ ...sample, name: 'NamedOne' });
    expect(ctx.scenes.getByName('NamedOne')?.id).toBe(created.id);
    expect(ctx.scenes.getByName('NotExists')).toBeNull();
  });
});
