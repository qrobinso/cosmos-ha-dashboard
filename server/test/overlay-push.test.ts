import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';
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
  const designs = createDesignPacksRepo(db);
  const app = await buildHttpApp({ displays, settings, scenes, transitions, overrides, designs });
  const wss = attachWsHub(app.server, { displays, scenes, settings, transitions, overrides });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no address');
  return { app, wss, port: addr.port, displays };
}

function nextMsg(ws: WebSocket): Promise<{ type: string } & Record<string, unknown>> {
  return new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()))));
}

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

describe('overlay push', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>;
  beforeEach(async () => {
    ctx = await startServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('pushOverlayTo delivers an overlay message to a connected display', async () => {
    const display = ctx.displays.registerByName('Living Room');
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    const initial = recvN(ws, 2);
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Living Room' }));
    await initial; // welcome + display_config

    const recv = nextMsg(ws);
    ctx.wss.pushOverlayTo(display.id, { title: "Dinner's ready", timeout_ms: 5000 });
    const msg = (await recv) as { type: string; overlay: { title: string; timeout_ms: number } };
    expect(msg.type).toBe('overlay');
    expect(msg.overlay.title).toBe("Dinner's ready");
    expect(msg.overlay.timeout_ms).toBe(5000);

    ws.close();
  });

  it('dismissOverlayFor delivers an overlay_dismiss message', async () => {
    const display = ctx.displays.registerByName('Kitchen');
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    const initial = recvN(ws, 2);
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Kitchen' }));
    await initial;

    const recv = nextMsg(ws);
    ctx.wss.dismissOverlayFor(display.id);
    const msg = await recv;
    expect(msg.type).toBe('overlay_dismiss');

    ws.close();
  });
});
