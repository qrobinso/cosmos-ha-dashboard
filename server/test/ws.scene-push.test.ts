import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';
import { attachWsHub } from '../src/api/ws.js';

async function startServer() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  const app = await buildHttpApp({ displays, settings, scenes, transitions, overrides });
  const wss = attachWsHub(app.server, { displays, scenes, settings, transitions, overrides });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no address');
  return { app, wss, port: addr.port, displays, scenes };
}

const sample = {
  name: 'Morning',
  layout: { cols: 12, rows: 8, items: [] },
  background: { type: 'solid' as const, color: '#101010' },
  typography: { font_family: 'Inter', font_scale: 1.0 },
  widgets: [
    { kind: 'clock' as const, position: { col: 1, row: 1, w: 6, h: 2 }, config: {} },
  ],
};

function recvN(ws: WebSocket, n: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const acc: unknown[] = [];
    const handler = (data: WebSocket.RawData) => {
      acc.push(JSON.parse(data.toString()));
      if (acc.length === n) {
        ws.off('message', handler);
        resolve(acc);
      }
    };
    ws.on('message', handler);
  });
}

describe('WebSocket scene push', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    ctx = await startServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('on hello, sends welcome then a scene message when the display has a default scene', async () => {
    const scene = ctx.scenes.create(sample);
    const display = ctx.displays.registerByName('Living Room');
    ctx.displays.setDefaultScene(display.id, scene.id);

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    const recv = recvN(ws, 2);
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Living Room' }));

    const [welcome, scenePush] = (await recv) as [
      { type: string },
      { type: string; state: { id: string; widgets: { kind: string; data: unknown }[] } }
    ];
    expect(welcome.type).toBe('welcome');
    expect(scenePush.type).toBe('scene');
    expect(scenePush.state.id).toBe(scene.id);
    expect(scenePush.state.widgets[0].kind).toBe('clock');
    expect(scenePush.state.widgets[0].data).toBeNull();

    ws.close();
  });

  it('does not send a scene message when the display has no scene assigned', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    const messages: unknown[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Hallway' }));
    await new Promise((r) => setTimeout(r, 100));
    expect(messages.length).toBe(1);
    expect((messages[0] as { type: string }).type).toBe('welcome');
    ws.close();
  });

  it('pushSceneTo sends the current scene state to a connected display', async () => {
    const scene = ctx.scenes.create(sample);
    const display = ctx.displays.registerByName('Kitchen');
    ctx.displays.setDefaultScene(display.id, scene.id);

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    const initial = recvN(ws, 2);
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Kitchen' }));
    await initial;

    const next = recvN(ws, 1);
    ctx.wss.pushSceneTo(display.id);
    const [pushed] = (await next) as [{ type: string; state: { id: string } }];
    expect(pushed.type).toBe('scene');
    expect(pushed.state.id).toBe(scene.id);

    ws.close();
  });
});
