import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';
import { createCanvasExtrasStore } from '../src/api/canvases.js';
import { createFakeHaClient } from '../src/ha/fakeClient.js';
import { regenerateToken, setEnabled } from '../src/store/mcp-token.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return {
    displays: createDisplaysRepo(db),
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
    canvasExtras: createCanvasExtrasStore(),
  };
}

const sceneFixture = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid' as const, color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { kind: 'clock' as const, position: { col: 1, row: 1, w: 6, h: 2 }, config: { format: '24h' } },
  ],
};

/** Helper — POST a JSON-RPC body to /mcp with the given auth header. */
async function rpc(
  app: Awaited<ReturnType<typeof buildHttpApp>>,
  body: object,
  authHeader?: string
) {
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    payload: body,
  });
}

describe('MCP /mcp transport', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    app = await buildHttpApp({ ...ctx, haClient: createFakeHaClient([
      { entity_id: 'sensor.power', state: '1247', attributes: { friendly_name: 'Power', unit_of_measurement: 'W' } },
    ]) });
  });

  it('returns 503 when MCP is disabled', async () => {
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/not enabled/i);
  });

  it('returns 503 when enabled but no token', async () => {
    setEnabled(ctx.settings, true);
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/token not generated/i);
  });

  it('returns 401 when the bearer is missing', async () => {
    setEnabled(ctx.settings, true);
    regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the bearer is wrong', async () => {
    setEnabled(ctx.settings, true);
    regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'Bearer wrong-token');
    expect(res.statusCode).toBe(401);
  });

  it('tools/list with the right bearer returns the 11 tools', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.tools).toHaveLength(11);
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      'assign_scene_to_display',
      'create_scene',
      'get_scene',
      'list_displays',
      'list_ha_entities',
      'list_scenes',
      'list_transitions',
      'list_widgets',
      'patch_widget',
      'update_scene',
      'update_widget_content',
    ]);
    // No destructive tools.
    expect(names).not.toContain('activate_scene');
    expect(names).not.toContain('delete_scene');
    expect(names).not.toContain('delete_widget');
  });

  it('tools/call create_scene round-trips through app.inject', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'create_scene', arguments: { payload: sceneFixture } },
    }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.content[0].type).toBe('text');
    const created = JSON.parse(body.result.content[0].text);
    expect(created.name).toBe('Morning');
    expect(created.id).toBeTruthy();
    // And the scene actually landed in the repo.
    expect(ctx.scenes.list().map((s) => s.name)).toContain('Morning');
  });

  it('tools/call surfaces validation errors as isError:true', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'create_scene', arguments: { payload: { name: 'bad' } } },
    }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/invalid scene payload/i);
  });

  it('resources/list returns the three known URIs', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 4, method: 'resources/list' }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const uris = res.json().result.resources.map((r: { uri: string }) => r.uri).sort();
    expect(uris).toEqual([
      'cosmos://docs/canvas-widget-agent',
      'cosmos://docs/scene-agent',
      'cosmos://entities',
    ]);
  });

  it('resources/read returns the live entity catalog', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, {
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/read',
      params: { uri: 'cosmos://entities' },
    }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.contents[0].mimeType).toBe('text/markdown');
    expect(body.result.contents[0].text).toContain('sensor.power');
  });

  it('regenerate invalidates the old token immediately', async () => {
    setEnabled(ctx.settings, true);
    const oldToken = regenerateToken(ctx.settings);
    const ok = await rpc(app, { jsonrpc: '2.0', id: 6, method: 'tools/list' }, `Bearer ${oldToken}`);
    expect(ok.statusCode).toBe(200);

    regenerateToken(ctx.settings); // server-side rotation

    const stale = await rpc(app, { jsonrpc: '2.0', id: 7, method: 'tools/list' }, `Bearer ${oldToken}`);
    expect(stale.statusCode).toBe(401);
  });

  it('settings GET returns config; enable+regenerate flow works', async () => {
    let res = await app.inject({ method: 'GET', url: '/api/agent/mcp' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled: false, hasToken: false, token: null });

    res = await app.inject({
      method: 'POST',
      url: '/api/agent/mcp/enable',
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    const enabled = res.json();
    expect(enabled.enabled).toBe(true);
    expect(enabled.hasToken).toBe(true);
    expect(enabled.token).toMatch(/^cosmos_mcp_/);

    res = await app.inject({ method: 'POST', url: '/api/agent/mcp/regenerate' });
    expect(res.statusCode).toBe(200);
    const regenerated = res.json();
    expect(regenerated.token).not.toBe(enabled.token);
    expect(regenerated.token).toMatch(/^cosmos_mcp_/);
  });

  it('rejects a wrong-but-equal-length bearer (timingSafeEqual sanity)', async () => {
    setEnabled(ctx.settings, true);
    const real = regenerateToken(ctx.settings);
    // Wrong token, same length as the real one. timingSafeEqual must
    // reject these without leaking via timing. Functionally, we just
    // verify it 401s.
    const wrong = 'cosmos_mcp_' + '0'.repeat(real.length - 'cosmos_mcp_'.length);
    expect(wrong.length).toBe(real.length);
    expect(wrong).not.toBe(real);
    const res = await rpc(app, { jsonrpc: '2.0', id: 99, method: 'tools/list' }, `Bearer ${wrong}`);
    expect(res.statusCode).toBe(401);
  });
});
