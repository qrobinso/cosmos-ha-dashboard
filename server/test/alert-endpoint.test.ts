import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';
import { createAlertManager, type AlertManager } from '../src/scenes/alerts.js';

const sample = {
  name: 'Doorbell',
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

describe('POST /api/displays/:name/scene/alert', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let alerts: AlertManager;
  let onSceneChangedCalls: { displayId: string; opts?: { skipHistory?: boolean; explicitTransitionId?: string | null } }[];
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    onSceneChangedCalls = [];
    const onSceneChanged = (displayId: string, opts?: { skipHistory?: boolean; explicitTransitionId?: string | null }) => {
      onSceneChangedCalls.push({ displayId, opts });
    };
    alerts = createAlertManager({ displays: ctx.displays, onSceneChanged });
    app = await buildHttpApp({ ...ctx, onSceneChanged, alerts });
  });

  it('200 fires the alert and reports active state', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/alert`,
      payload: { sceneId: scene.id, dwellMs: 5000 },
    });
    expect(res.statusCode).toBe(200);
    expect(alerts.isActive(display.id)).toBe(true);
    expect(ctx.displays.getById(display.id)?.currentSceneId).toBe(scene.id);
    alerts.cancel(display.id);
  });

  it('200 honors transitionId', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/alert`,
      payload: { sceneId: scene.id, dwellMs: 5000, transitionId: 'builtin-cross-fade' },
    });
    expect(onSceneChangedCalls[0].opts?.explicitTransitionId).toBe('builtin-cross-fade');
    alerts.cancel(display.id);
  });

  it('404 missing display', async () => {
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/Nope/scene/alert',
      payload: { sceneId: scene.id, dwellMs: 5000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404 missing scene', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/alert`,
      payload: { sceneId: 'no-such-scene', dwellMs: 5000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 missing sceneId', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/alert`,
      payload: { dwellMs: 5000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 missing or non-numeric dwellMs', async () => {
    const display = (await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Hall' } })).json();
    const scene = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const r1 = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/alert`,
      payload: { sceneId: scene.id },
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({
      method: 'POST',
      url: `/api/displays/${encodeURIComponent(display.name)}/scene/alert`,
      payload: { sceneId: scene.id, dwellMs: 'oops' },
    });
    expect(r2.statusCode).toBe(400);
  });
});
