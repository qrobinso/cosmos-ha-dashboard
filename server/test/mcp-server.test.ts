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
    designs: createDesignPacksRepo(db),
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

  it('tools/list with the right bearer returns the full tool surface', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      'activate_scene',
      'assign_scene_to_display',
      'create_design',
      'create_scene',
      'delete_scene',
      'delete_widget',
      'get_design',
      'get_display_palette',
      'get_scene',
      'list_designs',
      'list_displays',
      'list_ha_entities',
      'list_scenes',
      'list_transitions',
      'list_widgets',
      'patch_scene',
      'patch_widget',
      'summarize_ha_entities',
      'update_design',
      'update_scene',
      'update_widget_content',
    ]);
    // delete_scene / delete_widget are exposed but described as DESTRUCTIVE
    // and should be gated behind the client's confirm UI. Their tool
    // descriptions tell the model to require explicit user intent.
    const destructive = body.result.tools.filter(
      (t: { name: string; description: string }) =>
        t.name === 'delete_scene' || t.name === 'delete_widget'
    );
    for (const t of destructive) {
      expect(t.description.toUpperCase()).toContain('DESTRUCTIVE');
    }
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
    // The bad payload is missing layout — the sharpened message now
    // names the offending field instead of the generic "invalid scene".
    expect(body.result.content[0].text).toMatch(/layout/i);
  });

  it('resources/list returns the known baseline URIs plus design pack index', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 4, method: 'resources/list' }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const uris = res.json().result.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain('cosmos://docs/canvas-widget-agent');
    expect(uris).toContain('cosmos://docs/scene-agent');
    expect(uris).toContain('cosmos://entities');
    expect(uris).toContain('cosmos://designs');
  });

  it('resources/list includes per-pack URIs for seeded design packs', async () => {
    setEnabled(ctx.settings, true);
    ctx.designs.create({ slug: 'sample', name: 'Sample', content: '---\nname: Sample\n---\nbody', source: 'user' });
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 4, method: 'resources/list' }, `Bearer ${token}`);
    const uris = res.json().result.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain('cosmos://designs');
    expect(uris).toContain('cosmos://designs/sample');
  });

  it('tools/call list_designs returns the seeded packs', async () => {
    setEnabled(ctx.settings, true);
    ctx.designs.create({ slug: 'a', name: 'A', content: '---\nname: A\n---\nb', source: 'user' });
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, {
      jsonrpc: '2.0', id: 99, method: 'tools/call',
      params: { name: 'list_designs', arguments: {} },
    }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.json().result.content[0].text) as Array<{ slug: string }>;
    expect(list.map((p) => p.slug)).toContain('a');
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

  it('tools/call update_scene round-trips with an object payload (no 415)', async () => {
    // Regression for the bug Claude Code surfaced: update_scene was
    // returning 415 because the LLM-supplied payload reached app.inject
    // without an explicit content-type. The MCP inject helper now
    // normalizes object payloads → JSON.stringify + content-type:
    // application/json. Verify update_scene goes through cleanly.
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const created = await rpc(app, {
      jsonrpc: '2.0', id: 20, method: 'tools/call',
      params: { name: 'create_scene', arguments: { payload: sceneFixture } },
    }, `Bearer ${token}`);
    const sceneId = JSON.parse(created.json().result.content[0].text).id;

    const res = await rpc(app, {
      jsonrpc: '2.0', id: 21, method: 'tools/call',
      params: { name: 'update_scene', arguments: {
        id: sceneId,
        payload: { ...sceneFixture, name: 'Renamed' },
      } },
    }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.isError).toBeUndefined();
    const updated = JSON.parse(body.result.content[0].text);
    expect(updated.name).toBe('Renamed');
  });

  it('patch_scene JSON Schema declares background + mood as objects (no string-coercion in clients)', async () => {
    // Regression for the silent-corruption bug: when these fields used
    // z.any(), the emitted JSON Schema had no "type" annotation and
    // some MCP clients string-coerced the values before sending. Now
    // they're z.object({...}).passthrough() — assert that the schema
    // surface clients see actually has type:object.
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const res = await rpc(app, { jsonrpc: '2.0', id: 50, method: 'tools/list' }, `Bearer ${token}`);
    const tools = res.json().result.tools as Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }>;
    const patchScene = tools.find((t) => t.name === 'patch_scene')!;
    expect(patchScene).toBeDefined();
    const bgSchema = patchScene.inputSchema.properties?.background as { type?: string } | undefined;
    const moodSchema = patchScene.inputSchema.properties?.mood as { type?: string } | undefined;
    expect(bgSchema?.type).toBe('object');
    expect(moodSchema?.type).toBe('object');
  });

  it('tools/call patch_scene preserves widgets and only patches metadata', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    const created = await rpc(app, {
      jsonrpc: '2.0', id: 30, method: 'tools/call',
      params: { name: 'create_scene', arguments: { payload: sceneFixture } },
    }, `Bearer ${token}`);
    const sceneId = JSON.parse(created.json().result.content[0].text).id;
    const originalWidgetCount = ctx.scenes.get(sceneId)!.widgets.length;
    expect(originalWidgetCount).toBeGreaterThan(0);

    const res = await rpc(app, {
      jsonrpc: '2.0', id: 31, method: 'tools/call',
      params: { name: 'patch_scene', arguments: {
        id: sceneId,
        background: { type: 'solid', color: '#1a1a2e' },
      } },
    }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.isError).toBeUndefined();

    const after = ctx.scenes.get(sceneId)!;
    expect(after.background).toEqual({ type: 'solid', color: '#1a1a2e' });
    // Widgets untouched.
    expect(after.widgets.length).toBe(originalWidgetCount);
    // Other metadata (name, typography) preserved.
    expect(after.name).toBe('Morning');
    expect(after.typography.font_family).toBe('Inter');
  });

  it('tools/call activate_scene flips the display\'s currentSceneId', async () => {
    setEnabled(ctx.settings, true);
    const token = regenerateToken(ctx.settings);
    // Seed a display + a scene.
    const display = ctx.displays.registerByName('Living Room');
    const created = await rpc(app, {
      jsonrpc: '2.0', id: 40, method: 'tools/call',
      params: { name: 'create_scene', arguments: { payload: sceneFixture } },
    }, `Bearer ${token}`);
    const sceneId = JSON.parse(created.json().result.content[0].text).id;

    const res = await rpc(app, {
      jsonrpc: '2.0', id: 41, method: 'tools/call',
      params: { name: 'activate_scene', arguments: { displayName: 'Living Room', sceneId } },
    }, `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().result.isError).toBeUndefined();

    const after = ctx.displays.getById(display.id);
    expect(after?.currentSceneId).toBe(sceneId);
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
    // endpointHosts is platform-dependent (depends on local NICs) — shape-check only.
    expect(Array.isArray(res.json().endpointHosts)).toBe(true);

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
