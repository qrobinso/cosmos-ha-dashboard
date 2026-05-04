import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { buildHttpApp } from '../src/api/http.js';
import { attachWsHub } from '../src/api/ws.js';

async function startServer() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const app = await buildHttpApp({ displays, settings });
  attachWsHub(app.server, { displays });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no address');
  return { app, port: addr.port, displays };
}

function recv(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
}

describe('WebSocket hub', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    ctx = await startServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('responds to hello with a welcome message containing the display name', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Living Room' }));
    const msg = JSON.parse(await recv(ws));
    expect(msg.type).toBe('welcome');
    expect(msg.message).toBe('Hello, Living Room!');
    expect(typeof msg.displayId).toBe('string');
    ws.close();
  });

  it('registers the display in the repo on hello', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Kitchen' }));
    await recv(ws);
    expect(ctx.displays.getByName('Kitchen')).not.toBeNull();
    ws.close();
  });
});
