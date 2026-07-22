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
import { attachWsHub, type WsDeps } from '../src/api/ws.js';
import type { VoiceRelay } from '../src/voice/relay.js';

async function startServer(extraDeps: Partial<WsDeps> = {}) {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  const designs = createDesignPacksRepo(db);
  const app = await buildHttpApp({ displays, settings, scenes, transitions, overrides, designs });
  const wss = attachWsHub(app.server, { displays, scenes, settings, transitions, overrides, ...extraDeps });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no address');
  return { app, wss, port: addr.port, displays, scenes };
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

/** Waits until `arr` contains an element matching `pred`, polling rather than
 *  racing a single `once('message')` listener against another — the server
 *  can emit multiple frames (welcome, display_config, ...) synchronously in
 *  one burst, and two sequential `once()` calls can miss whichever frame
 *  lands between the first resolving and the second attaching. */
async function waitFor(arr: unknown[], pred: (m: unknown) => boolean, timeoutMs = 2000): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = arr.find(pred);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for message');
}

describe('WebSocket voice relay', () => {
  it('relays voice_audio frames through the voice relay and pushes voice_result back', async () => {
    const results: import('../src/voice/types.js').VoiceResult[] = [
      { stage: 'stt-end', text: 'turn on the lights' },
    ];
    const fakeRelay: VoiceRelay = {
      async runUtterance(_pipelineId, _chunks, onResult) {
        for (const r of results) onResult(r);
      },
    };
    const ctx = await startServer({ voiceRelay: fakeRelay });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
      const received: unknown[] = [];
      ws.on('message', (data) => received.push(JSON.parse(data.toString())));
      await new Promise<void>((r) => ws.once('open', () => r()));
      ws.send(JSON.stringify({ type: 'hello', displayName: 'Living Room' }));
      await waitFor(received, (m) => (m as { type?: string }).type === 'welcome');

      ws.send(
        JSON.stringify({
          type: 'voice_audio',
          seq: 0,
          chunk: Buffer.from([1, 2, 3]).toString('base64'),
          final: true,
        })
      );
      await waitFor(received, (m) => (m as { type?: string }).type === 'voice_result');
      expect(received).toContainEqual({ type: 'voice_result', stage: 'stt-end', text: 'turn on the lights' });
      ws.close();
    } finally {
      await ctx.app.close();
    }
  });

  it('rewrites a relative tts-end audioUrl through the ha-media proxy convention', async () => {
    const results: import('../src/voice/types.js').VoiceResult[] = [
      { stage: 'tts-end', audioUrl: '/api/tts_proxy/abc.mp3' },
    ];
    const fakeRelay: VoiceRelay = {
      async runUtterance(_pipelineId, _chunks, onResult) {
        for (const r of results) onResult(r);
      },
    };
    const ctx = await startServer({ voiceRelay: fakeRelay, mediaUrlBase: 'http://ha.local:8123' });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
      const received: unknown[] = [];
      ws.on('message', (data) => received.push(JSON.parse(data.toString())));
      await new Promise<void>((r) => ws.once('open', () => r()));
      ws.send(JSON.stringify({ type: 'hello', displayName: 'Living Room' }));
      await waitFor(received, (m) => (m as { type?: string }).type === 'welcome');

      ws.send(JSON.stringify({ type: 'voice_audio', seq: 0, chunk: Buffer.from([1]).toString('base64'), final: true }));
      await waitFor(received, (m) => (m as { type?: string }).type === 'voice_result');
      expect(received).toContainEqual({
        type: 'voice_result',
        stage: 'tts-end',
        audioUrl: '/api/ha-media/api/tts_proxy/abc.mp3',
      });
      ws.close();
    } finally {
      await ctx.app.close();
    }
  });

  it('leaves an already-absolute tts-end audioUrl unchanged', async () => {
    const results: import('../src/voice/types.js').VoiceResult[] = [
      { stage: 'tts-end', audioUrl: 'https://cdn.example.com/abc.mp3' },
    ];
    const fakeRelay: VoiceRelay = {
      async runUtterance(_pipelineId, _chunks, onResult) {
        for (const r of results) onResult(r);
      },
    };
    const ctx = await startServer({ voiceRelay: fakeRelay });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
      const received: unknown[] = [];
      ws.on('message', (data) => received.push(JSON.parse(data.toString())));
      await new Promise<void>((r) => ws.once('open', () => r()));
      ws.send(JSON.stringify({ type: 'hello', displayName: 'Living Room' }));
      await waitFor(received, (m) => (m as { type?: string }).type === 'welcome');

      ws.send(JSON.stringify({ type: 'voice_audio', seq: 0, chunk: Buffer.from([1]).toString('base64'), final: true }));
      await waitFor(received, (m) => (m as { type?: string }).type === 'voice_result');
      expect(received).toContainEqual({
        type: 'voice_result',
        stage: 'tts-end',
        audioUrl: 'https://cdn.example.com/abc.mp3',
      });
      ws.close();
    } finally {
      await ctx.app.close();
    }
  });
});
