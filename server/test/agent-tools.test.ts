import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';
import { createCanvasExtrasStore } from '../src/api/canvases.js';
import { createAutoExecuteTools, CONFIRM_REQUIRED_TOOLS, createConfirmRequiredTools } from '../src/agent/tools.js';
import { createFakeHaClient } from '../src/ha/fakeClient.js';
import { createDisplayPaletteStore } from '../src/store/displayPalette.js';
import type { HaClient } from '../src/ha/types.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  const canvasExtras = createCanvasExtrasStore();
  const displayPalette = createDisplayPaletteStore();
  return { displays, settings, scenes, transitions, overrides, canvasExtras, displayPalette };
}

const sceneFixture = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid' as const, color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { kind: 'clock' as const, position: { col: 1, row: 1, w: 6, h: 2 }, config: { format: '24h' } },
    { kind: 'canvas' as const, position: { col: 7, row: 1, w: 6, h: 6 }, config: { content: '<div>hi</div>' } },
  ],
};

/** Helper — invoke a tool's `execute` like streamText would. */
async function run(
  tools: ReturnType<typeof createAutoExecuteTools>,
  name: string,
  args: unknown
): Promise<unknown> {
  const t = tools[name];
  if (!t) throw new Error(`unknown tool ${name}`);
  if (typeof (t as { execute?: unknown }).execute !== 'function') {
    throw new Error(`tool ${name} has no execute (confirm-required)`);
  }
  return (t as { execute: (args: unknown, opts: unknown) => Promise<unknown> }).execute(args, { toolCallId: 't1', messages: [] });
}

describe('agent tools', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let ctx: ReturnType<typeof setup>;
  let haClient: HaClient;
  let tools: ReturnType<typeof createAutoExecuteTools>;

  beforeEach(async () => {
    ctx = setup();
    app = await buildHttpApp(ctx);
    haClient = createFakeHaClient([
      { entity_id: 'sensor.power', state: '1247', attributes: { friendly_name: 'Power', unit_of_measurement: 'W', device_class: 'power' } },
      { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen', brightness: 192 } },
      { entity_id: 'sensor.kitchen_temp', state: '21.5', attributes: { friendly_name: 'Temp', unit_of_measurement: '°C' } },
    ]);
    tools = createAutoExecuteTools({ app, haClient });
  });

  it('list_scenes returns id, name, widgetCount, defaultTransitionId', async () => {
    await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneFixture });
    const result = (await run(tools, 'list_scenes', {})) as Array<{ id: string; name: string; widgetCount: number }>;
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Morning');
    expect(result[0].widgetCount).toBe(2);
  });

  it('create_scene proxies through POST /api/scenes', async () => {
    const result = (await run(tools, 'create_scene', { payload: sceneFixture })) as { id: string; name: string };
    expect(result.id).toBeTruthy();
    expect(result.name).toBe('Morning');
    // And the scene actually landed in the repo.
    expect(ctx.scenes.list().map((s) => s.name)).toContain('Morning');
  });

  it('create_scene surfaces validation errors as { error, status }', async () => {
    const result = (await run(tools, 'create_scene', { payload: { name: 'bad' } })) as { error: string; status: number };
    expect(result.status).toBe(400);
    expect(typeof result.error).toBe('string');
  });

  it('list_widgets filters by scene + kind, truncates canvas content', async () => {
    const longHtml = '<div>' + 'x'.repeat(2000) + '</div>';
    await app.inject({
      method: 'POST',
      url: '/api/scenes',
      payload: { ...sceneFixture, widgets: [
        sceneFixture.widgets[0],
        { ...sceneFixture.widgets[1], config: { content: longHtml } },
      ] },
    });
    const all = (await run(tools, 'list_widgets', {})) as Array<{ kind: string; config: Record<string, unknown> }>;
    expect(all).toHaveLength(2);
    const canvasOnly = (await run(tools, 'list_widgets', { kind: 'canvas' })) as Array<{ kind: string; config: { content?: string } }>;
    expect(canvasOnly).toHaveLength(1);
    // Canvas content should be truncated (preview).
    expect(canvasOnly[0].config.content!.length).toBeLessThan(longHtml.length);
  });

  it('update_widget_content replaces the canvas content', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneFixture });
    const sceneId = created.json().id;
    const widgets = (await run(tools, 'list_widgets', { scene: sceneId, kind: 'canvas' })) as Array<{ id: string }>;
    const canvasId = widgets[0].id;
    const result = await run(tools, 'update_widget_content', { id: canvasId, content: '<div>updated</div>' });
    expect(result).toMatchObject({ id: sceneId });
    const after = ctx.scenes.get(sceneId);
    const canvas = after!.widgets.find((w) => w.kind === 'canvas');
    expect((canvas!.config as { content: string }).content).toBe('<div>updated</div>');
  });

  it('patch_widget shallow-merges config', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/scenes', payload: sceneFixture });
    const sceneId = created.json().id;
    const widgets = (await run(tools, 'list_widgets', { scene: sceneId, kind: 'clock' })) as Array<{ id: string }>;
    const clockId = widgets[0].id;
    await run(tools, 'patch_widget', { id: clockId, config: { format: '12h' } });
    const after = ctx.scenes.get(sceneId);
    const clock = after!.widgets.find((w) => w.kind === 'clock');
    // Shallow merge: format updated, no other keys lost.
    expect(clock!.config).toMatchObject({ format: '12h' });
  });

  it('list_ha_entities returns compact projections + filters by domain', async () => {
    const all = (await run(tools, 'list_ha_entities', {})) as Array<{ entity_id: string; friendly_name: string | null; unit: string | null }>;
    expect(all).toHaveLength(3);
    const sensors = (await run(tools, 'list_ha_entities', { domain: 'sensor' })) as Array<{ entity_id: string }>;
    expect(sensors).toHaveLength(2);
    expect(sensors.map((e) => e.entity_id)).toContain('sensor.power');
  });

  it('list_ha_entities surfaces an error when HA is not connected', async () => {
    const noHa = createAutoExecuteTools({ app, haClient: null });
    const result = (await run(noHa, 'list_ha_entities', {})) as { error: string };
    expect(result.error).toMatch(/Home Assistant is not connected/i);
  });

  it('get_display_palette returns the resolved palette for a display', async () => {
    ctx.displays.registerByName('kitchen-wall');
    await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000', '#00ff00'] },
    });
    const result = (await run(tools, 'get_display_palette', { displayName: 'kitchen-wall' })) as { colors: string[]; updatedAt: string | null };
    expect(result.colors.length).toBeGreaterThan(0);
    expect(result.updatedAt).not.toBeNull();
  });

  it('get_display_palette returns empty when nothing has been reported', async () => {
    ctx.displays.registerByName('quiet-wall');
    const result = (await run(tools, 'get_display_palette', { displayName: 'quiet-wall' })) as { colors: string[]; updatedAt: string | null };
    expect(result).toEqual({ colors: [], updatedAt: null });
  });
});

describe('confirm-required tools', () => {
  it('CONFIRM_REQUIRED_TOOLS catalog matches the tool record', () => {
    const confirm = createConfirmRequiredTools();
    expect(Object.keys(confirm).sort()).toEqual([...CONFIRM_REQUIRED_TOOLS].sort());
  });

  it('confirm-required tools have NO server-side execute', () => {
    const confirm = createConfirmRequiredTools();
    for (const name of CONFIRM_REQUIRED_TOOLS) {
      const t = confirm[name];
      expect(t).toBeDefined();
      expect((t as { execute?: unknown }).execute).toBeUndefined();
    }
  });
});

describe('agent settings endpoints', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;

  beforeEach(async () => {
    const ctx = setup();
    app = await buildHttpApp(ctx);
  });

  it('GET returns hasKey:false until a key is set', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agent/settings' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasKey).toBe(false);
    expect(body.model).toBe('anthropic/claude-sonnet-4-6');
    expect(body.confirmRequiredTools).toContain('activate_scene');
  });

  it('PUT sets the key and the model', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent/settings',
      payload: { key: 'sk-or-v1-test', model: 'openai/gpt-5' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hasKey: true, model: 'openai/gpt-5' });
  });

  it('PUT with empty key clears it', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/agent/settings',
      payload: { key: 'sk-or-v1-test' },
    });
    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/agent/settings',
      payload: { key: '' },
    });
    expect(cleared.json().hasKey).toBe(false);
  });

  it('POST /api/agent/chat returns 503 when key is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/chat',
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/key not set/i);
  });
});
