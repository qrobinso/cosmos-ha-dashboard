import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';
import { createCanvasExtrasStore } from '../src/api/canvases.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  const canvasExtras = createCanvasExtrasStore();
  return { displays, settings, scenes, transitions, overrides, canvasExtras };
}

const sample = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid', color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { kind: 'clock', position: { col: 1, row: 1, w: 6, h: 2 }, config: { format: '24h' } },
  ],
};

describe('scenes REST API', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    app = await buildHttpApp(ctx);
  });

  it('POST /api/scenes creates a scene', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/scenes', payload: sample });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Morning');
    expect(body.id).toBeTruthy();
  });

  it('POST /api/scenes returns 400 on missing name', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/scenes', payload: { ...sample, name: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/scenes lists scenes', async () => {
    await app.inject({ method: 'POST', url: '/api/scenes', payload: { ...sample, name: 'A' } });
    await app.inject({ method: 'POST', url: '/api/scenes', payload: { ...sample, name: 'B' } });
    const res = await app.inject({ method: 'GET', url: '/api/scenes' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((s: { name: string }) => s.name).sort()).toEqual(['A', 'B']);
  });

  it('GET /api/scenes/:id returns one scene', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({ method: 'GET', url: `/api/scenes/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(created.id);
  });

  it('GET /api/scenes/:id returns 404 when missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenes/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /api/scenes/:id updates the scene', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/scenes/${created.id}`,
      payload: { ...sample, name: 'Morning v2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Morning v2');
  });

  it('DELETE /api/scenes/:id removes it', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/scenes/${created.id}` });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `/api/scenes/${created.id}` });
    expect(get.statusCode).toBe(404);
  });

  it('POST /api/displays/:name/assign-scene assigns a scene as default', async () => {
    const display = (await app.inject({
      method: 'POST',
      url: '/api/displays/register',
      payload: { name: 'Living Room' },
    })).json();
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/assign-scene`,
      payload: { sceneId: scene.id, makeDefault: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().defaultSceneId).toBe(scene.id);
  });

  it('POST assign-scene returns 404 for unknown display', async () => {
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/Nope/assign-scene',
      payload: { sceneId: scene.id, makeDefault: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/scenes accepts a valid mood config and returns it on the scene', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: { ...sample, mood: { enabled: true, strategy: 'manual', moodId: 'clouds' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mood).toEqual({ enabled: true, strategy: 'manual', moodId: 'clouds' });
  });

  it('POST /api/scenes 400s when manual mood has an empty moodId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: { ...sample, mood: { enabled: true, strategy: 'manual', moodId: '' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/scenes 400s when manual mood has a moodId with path separators', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: { ...sample, mood: { enabled: true, strategy: 'manual', moodId: '../escape' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/scenes 400s when weather strategy lacks weatherEntity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: { ...sample, mood: { enabled: true, strategy: 'weather' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/moods returns the scanned mood files (or empty when no folder)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/moods' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('POST /api/scenes accepts a canvas widget and round-trips its content', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: {
        ...sample,
        widgets: [
          {
            kind: 'canvas',
            position: { col: 1, row: 1, w: 4, h: 4 },
            config: { content: '<h1>Hello {{ states("sensor.power") }}</h1>' },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.widgets[0].kind).toBe('canvas');
    expect(body.widgets[0].config.content).toBe('<h1>Hello {{ states("sensor.power") }}</h1>');
  });

  it('POST /api/canvases/:widgetId/subscribe records extras and returns 204', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvases/w1/subscribe',
      payload: { display_name: 'Living Room', entity_ids: ['sensor.power', 'sensor.temp'] },
    });
    expect(res.statusCode).toBe(204);
    const recorded = ctx.canvasExtras.list('Living Room', 'w1');
    expect(recorded).toContain('sensor.power');
    expect(recorded).toContain('sensor.temp');
  });

  it('POST /api/canvases/:widgetId/subscribe rejects malformed bodies', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvases/w1/subscribe',
      payload: { entity_ids: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });
});
