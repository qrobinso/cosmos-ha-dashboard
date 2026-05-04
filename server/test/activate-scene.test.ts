import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';

const sample = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid' as const, color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [],
};

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  return { displays, settings, scenes, transitions, overrides };
}

describe('POST /api/displays/:name/scene/activate', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let calls: Array<{ displayId: string; opts?: { explicitTransitionId?: string | null } }>;
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    calls = [];
    app = await buildHttpApp({ ...ctx, onSceneChanged: (id, opts) => calls.push({ displayId: id, opts }) });
  });

  it('sets currentSceneId and triggers onSceneChanged with no explicit transition', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/activate`,
      payload: { sceneId: scene.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().currentSceneId).toBe(scene.id);
    expect(calls.length).toBe(1);
    expect(calls[0].displayId).toBe(display.id);
    expect(calls[0].opts?.explicitTransitionId).toBeNull();
  });

  it('passes explicit transitionId through', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/activate`,
      payload: { sceneId: scene.id, transitionId: 'builtin-slide-up' },
    });
    expect(calls[0].opts?.explicitTransitionId).toBe('builtin-slide-up');
  });

  it('returns 404 for missing display', async () => {
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/Nope/scene/activate',
      payload: { sceneId: scene.id },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for missing scene', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/activate`,
      payload: { sceneId: 'no-such-scene' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for unknown transitionId', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/activate`,
      payload: { sceneId: scene.id, transitionId: 'no-such-transition' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/transition/i);
  });

  it('returns 400 when sceneId is missing', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/activate`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
