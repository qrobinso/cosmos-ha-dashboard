import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';
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
  const designs = createDesignPacksRepo(db);
  const canvasExtras = createCanvasExtrasStore();
  return { displays, settings, scenes, transitions, overrides, designs, canvasExtras };
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

  it('GET /api/scenes/:id/preview returns an assembled SceneState', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({ method: 'GET', url: `/api/scenes/${created.id}/preview` });
    expect(res.statusCode).toBe(200);
    const state = res.json();
    expect(state.id).toBe(created.id);
    expect(state.name).toBe('Morning');
    // widgets are resolved — each carries a `data` field (mock data when HA is off)
    expect(Array.isArray(state.widgets)).toBe(true);
    expect(state.widgets[0]).toHaveProperty('data');
    // safeArea is included so the kiosk renderer can pad correctly
    expect(state.safeArea).toEqual({ top: expect.any(Number), right: expect.any(Number), bottom: expect.any(Number), left: expect.any(Number) });
  });

  it('GET /api/scenes/:id/preview returns 404 for an unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scenes/nope/preview' });
    expect(res.statusCode).toBe(404);
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

  it('POST /api/scenes rejects an unknown widget kind', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: {
        ...sample,
        widgets: [
          { kind: 'frobnicate', position: { col: 1, row: 1, w: 2, h: 2 }, config: {} },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not a known widget kind/i);
  });

  it('PUT /api/scenes/:id rejects an unknown widget kind', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/scenes', payload: sample })).json();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/scenes/${created.id}`,
      payload: {
        ...sample,
        widgets: [
          { kind: 'whatever', position: { col: 1, row: 1, w: 2, h: 2 }, config: {} },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not a known widget kind/i);
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

  it('GET /api/canvases/:widgetId/calendar-events returns mock events when HA is disabled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvases/w1/calendar-events?entity_id=calendar.home&start=2026-05-09T00:00:00Z&end=2026-05-16T00:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('GET /api/canvases/:widgetId/calendar-events 400s on missing entity_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvases/w1/calendar-events?start=2026-05-09T00:00:00Z&end=2026-05-16T00:00:00Z',
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/canvases/:widgetId/calendar-events 400s on non-ISO start', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvases/w1/calendar-events?entity_id=calendar.home&start=tomorrow&end=2026-05-16T00:00:00Z',
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/canvases/:widgetId/calendar-events 400s when end <= start', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvases/w1/calendar-events?entity_id=calendar.home&start=2026-05-16T00:00:00Z&end=2026-05-09T00:00:00Z',
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/canvases/:widgetId/calendar-events uses the cache when one is wired', async () => {
    let calls = 0;
    const fakeFetcher = async () => {
      calls++;
      return [{ summary: 'evt', start: '2026-05-10T10:00:00Z', end: '2026-05-10T11:00:00Z', all_day: false }];
    };
    const { createCalendarCache } = await import('../src/ha/calendarCache.js');
    const calendarCache = createCalendarCache(fakeFetcher);
    const cached = await buildHttpApp({ ...ctx, calendarCache });
    const url = '/api/canvases/w1/calendar-events?entity_id=calendar.home&start=2026-05-09T00:00:00Z&end=2026-05-16T00:00:00Z';
    const a = await cached.inject({ method: 'GET', url });
    const b = await cached.inject({ method: 'GET', url });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(calls).toBe(1);
    expect(a.json().events).toHaveLength(1);
  });

  it('accepts mood: {enabled: false} without requiring strategy', async () => {
    // Regression: validateMood used to require `strategy` even when
    // `enabled: false`, which is nonsensical (the dormant mood is
    // configured by other fields). Now {enabled:false} alone passes.
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: { ...sample, mood: { enabled: false } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mood).toMatchObject({ enabled: false });
  });

  it('returns 400 (not 500) when a widget is missing config', async () => {
    // Regression: missing widget.config used to crash JSON.stringify in
    // the repo with a 500 — agent had no signal to fix the payload. Now
    // the API rejects with a clear message.
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: {
        ...sample,
        widgets: [{ kind: 'clock', position: { col: 1, row: 1, w: 6, h: 2 } }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/config is required/i);
  });

  it('PATCH /api/scenes/:id rejects a string-typed background (silent-corruption guard)', async () => {
    // Regression: some MCP clients string-coerce schema fields without an
    // explicit "type":"object" annotation. The PATCH handler used to
    // shallow-merge whatever it got, persisting a JSON string to disk
    // where the kiosk couldn't render it. Now the shape is validated
    // with a clear 400 before merge.
    const created = await app.inject({ method: 'POST', url: '/api/scenes', payload: sample });
    const sceneId = created.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      payload: { background: '{"type":"gradient","colors":["#000","#fff"]}' as unknown },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/background must be an object/i);

    // And the on-disk background is unchanged.
    expect(ctx.scenes.get(sceneId)!.background).toEqual(sample.background);
  });

  it('PATCH /api/scenes/:id rejects a malformed gradient background', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/scenes', payload: sample });
    const sceneId = created.json().id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      payload: { background: { type: 'gradient', colors: 'not-an-array' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/colors must be an array/i);
  });

  it('PATCH /api/scenes/:id partial-updates background without touching widgets', async () => {
    // Regression: there used to be no PATCH endpoint, only PUT. Agents
    // wanting "just change the background" had to round-trip the entire
    // scene — risky because update_scene's widget array is replace-not-
    // merge. PATCH preserves widgets verbatim.
    const created = await app.inject({ method: 'POST', url: '/api/scenes', payload: sample });
    const sceneId = created.json().id;
    const originalWidgetCount = created.json().widgets.length;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      payload: { background: { type: 'solid', color: '#1a1a2e' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().background).toEqual({ type: 'solid', color: '#1a1a2e' });
    expect(res.json().widgets.length).toBe(originalWidgetCount);
    // Other fields preserved.
    expect(res.json().name).toBe(sample.name);
    expect(res.json().typography).toEqual(sample.typography);
  });

  // ── Validation hardening (audit follow-up) ───────────────────────────
  // Each block here pins a previously-silent or 500-class failure to a
  // 4xx with a clear message, so an MCP/HTTP agent can self-correct.

  it('POST /api/scenes 400s when a widget position is out of grid bounds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: {
        ...sample,
        widgets: [{ kind: 'clock', position: { col: 99, row: 1, w: 1, h: 1 }, config: {} }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/extends past layout\.cols/);
  });

  it('POST /api/scenes 400s when a widget position has zero width', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: {
        ...sample,
        widgets: [{ kind: 'clock', position: { col: 1, row: 1, w: 0, h: 1 }, config: {} }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/w and .* must be >= 1/i);
  });

  it('POST /api/scenes 400s when an entity-bearing widget lacks entity_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: {
        ...sample,
        widgets: [{ kind: 'weather', position: { col: 1, row: 1, w: 4, h: 4 }, config: {} }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/entity_id is required/i);
  });

  it('POST /api/scenes 400s when entity_id is malformed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: {
        ...sample,
        widgets: [
          { kind: 'entity_tile', position: { col: 1, row: 1, w: 2, h: 2 }, config: { entity_id: 'no-domain' } },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not a valid HA entity id/);
  });

  it('POST /api/scenes 400s (not 500) when defaultTransitionId is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: { ...sample, defaultTransitionId: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/defaultTransitionId.*not found/);
  });

  it('PATCH /api/scenes/:id 400s (not 500) when defaultTransitionId is unknown', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/scenes', payload: sample });
    const sceneId = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/scenes/${sceneId}`,
      payload: { defaultTransitionId: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/defaultTransitionId.*not found/);
  });

  it('PATCH /api/widgets/:id rejects an empty body with a clear 400', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: {
        ...sample,
        widgets: [{ kind: 'clock', position: { col: 1, row: 1, w: 6, h: 2 }, config: {} }],
      },
    });
    const widgetId = created.json().widgets[0].id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/widgets/${widgetId}`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/at least one of "position" or "config"/);
  });

  it('PATCH /api/widgets/:id rejects out-of-grid position', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: {
        ...sample,
        widgets: [{ kind: 'clock', position: { col: 1, row: 1, w: 6, h: 2 }, config: {} }],
      },
    });
    const widgetId = created.json().widgets[0].id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/widgets/${widgetId}`,
      payload: { position: { col: 1, row: 1, w: 99, h: 99 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/extends past layout/);
  });

  it('DELETE /api/scenes/:id prunes the scene from display rotations', async () => {
    // Two scenes, one display, rotation across both.
    const a = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { ...sample, name: 'A' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/api/scenes', payload: { ...sample, name: 'B' } })).json();
    const display = (await app.inject({
      method: 'POST',
      url: '/api/displays/register',
      payload: { name: 'Living Room' },
    })).json();
    await app.inject({
      method: 'PUT',
      url: `/api/displays/${encodeURIComponent(display.name)}/rotation`,
      payload: { enabled: true, sceneIds: [a.id, b.id], intervalSec: 30 },
    });

    const del = await app.inject({ method: 'DELETE', url: `/api/scenes/${a.id}` });
    expect(del.statusCode).toBe(204);

    const all = (await app.inject({ method: 'GET', url: '/api/displays' })).json() as Array<{
      id: string;
      rotation?: { sceneIds: string[] };
    }>;
    const after = all.find((d) => d.id === display.id)!;
    expect(after.rotation?.sceneIds).toEqual([b.id]);
  });
});
