import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';
import { buildHttpApp } from '../src/api/http.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return {
    displays: createDisplaysRepo(db),
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
    designs: createDesignPacksRepo(db),
  };
}

const sceneWithCanvas = {
  name: 'Kitchen',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid' as const, color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    {
      kind: 'canvas',
      position: { col: 1, row: 1, w: 6, h: 4 },
      config: { content: '<div>old</div>', name: 'main' },
    },
    {
      kind: 'clock',
      position: { col: 7, row: 1, w: 6, h: 4 },
      config: { format: '24h' },
    },
  ],
};

describe('widget endpoints', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let pushes: Array<{ displayId: string }>;
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    pushes = [];
    app = await buildHttpApp({
      ...ctx,
      onSceneChanged: (id) => pushes.push({ displayId: id }),
    });
  });

  it('GET /api/widgets returns a flat list across scenes', async () => {
    await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneWithCanvas });
    const res = await app.inject({ method: 'GET', url: '/api/widgets' });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ kind: 'canvas', sceneName: 'Kitchen' });
    expect(list[1]).toMatchObject({ kind: 'clock', sceneName: 'Kitchen' });
  });

  it('GET /api/widgets filters by scene name + kind', async () => {
    await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneWithCanvas });
    const res = await app.inject({ method: 'GET', url: '/api/widgets?scene=Kitchen&kind=canvas' });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('canvas');
  });

  it('GET /api/widgets exposes config.name as a top-level field', async () => {
    await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneWithCanvas });
    const res = await app.inject({ method: 'GET', url: '/api/widgets?kind=canvas' });
    expect(res.json()).toEqual([
      expect.objectContaining({ kind: 'canvas', name: 'main' }),
    ]);
  });

  it('GET /api/widgets filters by name (case-insensitive exact)', async () => {
    await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneWithCanvas });
    const hit = await app.inject({ method: 'GET', url: '/api/widgets?name=MAIN' });
    expect(hit.statusCode).toBe(200);
    const list = hit.json();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('main');

    const miss = await app.inject({ method: 'GET', url: '/api/widgets?name=does-not-exist' });
    expect(miss.json()).toEqual([]);
  });

  it('PATCH /api/widgets/:id shallow-merges config', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneWithCanvas })).json();
    const widgetId = created.widgets[0].id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/widgets/${widgetId}`,
      payload: { config: { content: '<div>new</div>' } },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    const w = updated.widgets.find((w: { id: string }) => w.id === widgetId);
    expect(w.config.content).toBe('<div>new</div>');
    // Other config keys are preserved.
    expect(w.config.name).toBe('main');
  });

  it('PATCH triggers onSceneChanged for displays using the scene', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Wall' } })).json();
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneWithCanvas })).json();
    await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/activate`,
      payload: { sceneId: created.id },
    });
    pushes.length = 0;
    await app.inject({
      method: 'PATCH',
      url: `/api/widgets/${created.widgets[0].id}`,
      payload: { config: { content: 'updated' } },
    });
    expect(pushes.some((p) => p.displayId === display.id)).toBe(true);
  });

  it('PATCH 404 for unknown widget id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/widgets/no-such-id',
      payload: { config: { content: 'x' } },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /content accepts raw HTML on a canvas widget', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneWithCanvas })).json();
    const widgetId = created.widgets[0].id;
    const html = '<div>hello from agent</div>';
    const res = await app.inject({
      method: 'PUT',
      url: `/api/widgets/${widgetId}/content`,
      headers: { 'content-type': 'text/html' },
      payload: html,
    });
    expect(res.statusCode).toBe(200);
    const w = res.json().widgets.find((w: { id: string }) => w.id === widgetId);
    expect(w.config.content).toBe(html);
    expect(w.config.name).toBe('main'); // other fields preserved
  });

  it('PUT /content also accepts {"content": "..."} JSON', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneWithCanvas })).json();
    const widgetId = created.widgets[0].id;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/widgets/${widgetId}/content`,
      payload: { content: '<p>via json</p>' },
    });
    expect(res.statusCode).toBe(200);
    const w = res.json().widgets.find((w: { id: string }) => w.id === widgetId);
    expect(w.config.content).toBe('<p>via json</p>');
  });

  it('PUT /content rejects non-canvas widgets', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneWithCanvas })).json();
    const clockId = created.widgets[1].id;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/widgets/${clockId}/content`,
      headers: { 'content-type': 'text/html' },
      payload: '<div>nope</div>',
    });
    expect(res.statusCode).toBe(400);
  });
});
