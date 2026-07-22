# Voice Assistant (Wake Word → HA Assist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a kiosk display opt into always-on wake-word listening that hands utterances to Home Assistant's existing Assist pipeline over a relayed WebSocket connection, and plays the spoken response back through the kiosk's own speakers.

**Architecture:** Kiosk browser runs local wake-word detection and streams post-wake audio over the existing display↔server WebSocket; the Cosmos server relays that audio to a dedicated, second HA WebSocket connection via `assist_pipeline/run` and streams `stt-end`/`intent-end`/`tts-end` events back down to the display, which shows an overlay and plays the TTS audio. No Wyoming protocol, no new HA device entity — see `docs/superpowers/specs/2026-07-21-voice-assistant-design.md` for the full rationale.

**Tech Stack:** TypeScript, Fastify, `ws`, `better-sqlite3`, `home-assistant-js-websocket` (server); SvelteKit, Web Audio API, `onnxruntime-web` (display).

## Global Constraints

- Nothing changes shape or behavior when a display's `voice_enabled` is `false` (the default) — every new code path is additive and gated on that flag.
- The HA long-lived access token never reaches the browser; only the server holds it (both the existing `ha/` client and the new dedicated voice connection use the same `HA_URL`/`HA_TOKEN` env config).
- The voice HA WebSocket connection is independent from the existing `ha/` client's `state_changed` subscription — a long voice interaction must never block or delay reactive entity-cache updates.
- No on-kiosk mute button or "mic active" indicator — control is admin-only (per spec).
- No custom NLU/intent handling in Cosmos — HA Assist owns all speech understanding; Cosmos only relays audio and events.
- Follow existing repo conventions exactly: ESM with `.js` import extensions in `server/`, repos as `createXRepo(db) → XRepo` factories with prepared statements in closure, migrations append-only via `server/src/store/migrations.ts`, additive WS message unions.

---

## File Structure

**Server (`server/src/`):**
- `voice/types.ts` — new. `VoiceHealth`, `VoiceResultStage`, `VoiceAudioFrame`, `HaAssistPipeline` types.
- `voice/client.ts` — new. `makeVoiceHaClient(config: HaConfig): Promise<VoiceHaClient>` — dedicated second HA WS connection wrapping `assist_pipeline/run`.
- `voice/relay.ts` — new. `createVoiceRelay(client: VoiceHaClient): VoiceRelay` — orchestrates one utterance: audio chunks in, `VoiceResult` events out.
- `voice/pipelines.ts` — new. `listAssistPipelines(client: VoiceHaClient): Promise<HaAssistPipeline[]>`.
- `store/displays.ts` — modify. Add `voiceEnabled`/`voicePipelineId` to `Display`, `setVoice(id, {enabled, pipelineId})` to `DisplaysRepo`.
- `store/migrations.ts` — modify. Append migration version 10 adding `voice_enabled`/`voice_pipeline_id` columns to `displays`.
- `api/ha-assist.ts` — new. `registerHaAssistRoutes(app, deps)` — `GET /api/ha/assist-pipelines`.
- `api/displays.ts` (or wherever display routes live — confirmed below in Task 2) — modify. Add `PUT /api/displays/:name/voice`.
- `api/ws.ts` — modify. Extend `ClientMessage` to accept `voice_audio`/`voice_health`; add `pushVoiceResultTo` to `CosmosWss`; dispatch inbound voice messages into `voice/relay.ts`.
- `index.ts` — modify. Construct the voice HA client + relay at boot (mirrors existing `haClient` construction), wire into `WsDeps`.

**Display (`display/src/lib/`):**
- `ws.ts` — modify. Extend `ServerMessage` union with `VoiceResultMessage`; add `sendVoiceAudio`/`sendVoiceHealth` to `CosmosConnection`.
- `voice/types.ts` — new. Shared display-side voice types.
- `voice/capture.ts` — new. `createUtteranceCapture(onChunk, onEnd)` — buffers mic PCM frames until silence/timeout, emits chunks.
- `voice/wakeword.ts` — new. `createWakeWordDetector(onWake)` — loads the bundled ONNX wake-word model via `onnxruntime-web`, runs continuous inference over an `AudioWorklet` mic stream.
- `voice/index.ts` — new. `startVoiceAssistant(connection, onOverlayState)` — wires wake word → capture → `connection.sendVoiceAudio` → `voice_result` handling → playback.
- `routes/+layout.svelte` (or wherever the WS connection + display config are consumed — confirmed in Task 5) — modify. Call `startVoiceAssistant` when `DisplayConfig.voiceEnabled` is true.

**Admin (`display/src/lib/admin/`):**
- `api.ts` — modify. Add `displays.setVoice(displayName, {enabled, pipelineId}): Promise<void>` and `displays.listAssistPipelines(): Promise<HaAssistPipeline[]>`.
- `routes/admin/displays/+page.svelte` — modify. Add voice toggle + pipeline `<select>` + status readout in the per-row expand panel.

---

### Task 1: `displays` schema — add voice columns

**Files:**
- Modify: `server/src/store/migrations.ts`
- Modify: `server/src/store/displays.ts`
- Test: `server/src/store/displays.test.ts` (create if it doesn't already exist — check first with the step below)

**Interfaces:**
- Produces: `Display.voiceEnabled: boolean`, `Display.voicePipelineId: string | null`, `DisplaysRepo.setVoice(id: string, opts: { enabled: boolean; pipelineId: string | null }): void`

- [ ] **Step 1: Check for an existing displays repo test file**

Run: `ls server/src/store/displays.test.ts 2>/dev/null || echo "none"`

If it exists, add the new test into it following its existing style (import pattern, `:memory:` DB setup). If it prints `none`, create it fresh using the pattern below.

- [ ] **Step 2: Write the failing test**

```typescript
// server/src/store/displays.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';
import { createDisplaysRepo } from './displays.js';

describe('displays voice settings', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db as unknown as import('./db.js').DB);
  });

  it('defaults voiceEnabled to false and voicePipelineId to null', () => {
    const repo = createDisplaysRepo(db as unknown as import('./db.js').DB);
    const display = repo.registerByName('kitchen');
    expect(display.voiceEnabled).toBe(false);
    expect(display.voicePipelineId).toBeNull();
  });

  it('setVoice persists enabled flag and pipeline id', () => {
    const repo = createDisplaysRepo(db as unknown as import('./db.js').DB);
    const display = repo.registerByName('kitchen');
    repo.setVoice(display.id, { enabled: true, pipelineId: 'pipeline-123' });
    const updated = repo.getById(display.id);
    expect(updated?.voiceEnabled).toBe(true);
    expect(updated?.voicePipelineId).toBe('pipeline-123');
  });

  it('setVoice can clear the pipeline id back to null', () => {
    const repo = createDisplaysRepo(db as unknown as import('./db.js').DB);
    const display = repo.registerByName('kitchen');
    repo.setVoice(display.id, { enabled: true, pipelineId: 'pipeline-123' });
    repo.setVoice(display.id, { enabled: false, pipelineId: null });
    const updated = repo.getById(display.id);
    expect(updated?.voiceEnabled).toBe(false);
    expect(updated?.voicePipelineId).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace server test -- displays`
Expected: FAIL — `createDisplaysRepo` has no `setVoice`, and/or `voiceEnabled`/`voicePipelineId` are `undefined`.

- [ ] **Step 4: Append the migration**

In `server/src/store/migrations.ts`, add a new entry after the existing version-9 entry (before the closing `];` of the `migrations` array):

```typescript
  {
    version: 10,
    up: `
      ALTER TABLE displays ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE displays ADD COLUMN voice_pipeline_id TEXT;
    `,
  },
```

- [ ] **Step 5: Update `server/src/store/displays.ts`**

Add to the `Display` type:
```typescript
  voiceEnabled: boolean;
  voicePipelineId: string | null;
```

Add to the `DisplaysRepo` type:
```typescript
  setVoice(id: string, opts: { enabled: boolean; pipelineId: string | null }): void;
```

Add to the `Row` type:
```typescript
  voice_enabled: number;
  voice_pipeline_id: string | null;
```

Update `SELECT_COLS` to include `voice_enabled, voice_pipeline_id`.

Update the row-to-`Display` mapping function to include:
```typescript
    voiceEnabled: r.voice_enabled === 1,
    voicePipelineId: r.voice_pipeline_id,
```

Add a prepared statement alongside `updateOrientation`:
```typescript
  const updateVoice = db.prepare('UPDATE displays SET voice_enabled = ?, voice_pipeline_id = ? WHERE id = ?');
```

Add the method implementation alongside `setOrientation`:
```typescript
    setVoice(id, opts) {
      updateVoice.run(opts.enabled ? 1 : 0, opts.pipelineId, id);
    },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm --workspace server test -- displays`
Expected: PASS (all three new tests, plus existing displays tests unaffected)

- [ ] **Step 7: Run the full server suite to confirm no regressions**

Run: `npm --workspace server test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/store/migrations.ts server/src/store/displays.ts server/src/store/displays.test.ts
git commit -m "feat(voice): add voice_enabled/voice_pipeline_id columns to displays"
```

---

### Task 2: Server-side voice types + dedicated HA voice client

**Files:**
- Create: `server/src/voice/types.ts`
- Create: `server/src/voice/client.ts`
- Test: `server/src/voice/client.test.ts`

**Interfaces:**
- Consumes: `HaConfig` from `server/src/ha/client.ts` (`{ url: string; token: string }`)
- Produces:
  - `VoiceHealth = 'ok' | 'permission_denied' | 'model_load_failed' | 'idle' | 'error'`
  - `VoiceResultStage = 'listening' | 'stt-end' | 'intent-end' | 'tts-end' | 'error'`
  - `VoiceResult = { stage: VoiceResultStage; text?: string; audioUrl?: string; error?: string }`
  - `HaAssistPipeline = { id: string; name: string }`
  - `VoiceHaClient = { runPipeline(pipelineId: string | null, audioChunks: AsyncIterable<Uint8Array>): AsyncIterable<VoiceResult>; listPipelines(): Promise<HaAssistPipeline[]>; close(): void }`
  - `makeVoiceHaClient(config: HaConfig): Promise<VoiceHaClient>`

- [ ] **Step 1: Write `server/src/voice/types.ts`**

```typescript
// server/src/voice/types.ts
export type VoiceHealth = 'ok' | 'permission_denied' | 'model_load_failed' | 'idle' | 'error';

export type VoiceResultStage = 'listening' | 'stt-end' | 'intent-end' | 'tts-end' | 'error';

export type VoiceResult = {
  stage: VoiceResultStage;
  text?: string;
  audioUrl?: string;
  error?: string;
};

export type HaAssistPipeline = {
  id: string;
  name: string;
};

export type VoiceHaClient = {
  runPipeline(pipelineId: string | null, audioChunks: AsyncIterable<Uint8Array>): AsyncIterable<VoiceResult>;
  listPipelines(): Promise<HaAssistPipeline[]>;
  close(): void;
};
```

- [ ] **Step 2: Write the failing test for a fake-backed client shape**

Since `client.ts` wraps `home-assistant-js-websocket` (a real network client), the unit test targets the pure framing/orchestration logic by injecting a fake low-level connection. Write the test first against the intended `makeVoiceHaClient` contract using a minimal fake `Connection`:

```typescript
// server/src/voice/client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeVoiceHaClient } from './client.js';

vi.mock('home-assistant-js-websocket', () => {
  return {
    createLongLivedTokenAuth: vi.fn(() => ({})),
    createConnection: vi.fn(async () => ({
      sendMessagePromise: vi.fn(async (msg: { type: string }) => {
        if (msg.type === 'assist_pipeline/pipeline/list') {
          return { pipelines: [{ id: 'p1', name: 'Home' }], preferred_pipeline: 'p1' };
        }
        return {};
      }),
      subscribeMessage: vi.fn(async (_cb: unknown, _msg: unknown) => () => {}),
      close: vi.fn(),
    })),
  };
});

describe('makeVoiceHaClient', () => {
  it('lists pipelines from HA', async () => {
    const client = await makeVoiceHaClient({ url: 'http://ha.local:8123', token: 'tok' });
    const pipelines = await client.listPipelines();
    expect(pipelines).toEqual([{ id: 'p1', name: 'Home' }]);
    client.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace server test -- voice/client`
Expected: FAIL — `server/src/voice/client.ts` does not exist yet.

- [ ] **Step 4: Write `server/src/voice/client.ts`**

```typescript
// server/src/voice/client.ts
import { WebSocket as WsWebSocket } from 'ws';
const g = globalThis as unknown as { WebSocket?: typeof WsWebSocket };
if (typeof g.WebSocket === 'undefined') {
  g.WebSocket = WsWebSocket;
}

import { createConnection, createLongLivedTokenAuth, type Connection } from 'home-assistant-js-websocket';
import type { HaConfig } from '../ha/client.js';
import type { VoiceHaClient, VoiceResult, HaAssistPipeline } from './types.js';

type PipelineListResult = { pipelines: { id: string; name: string }[]; preferred_pipeline: string | null };

export async function makeVoiceHaClient(config: HaConfig): Promise<VoiceHaClient> {
  const auth = createLongLivedTokenAuth(config.url, config.token);
  const connection: Connection = await createConnection({ auth });

  return {
    async listPipelines(): Promise<HaAssistPipeline[]> {
      const result = (await connection.sendMessagePromise({
        type: 'assist_pipeline/pipeline/list',
      })) as PipelineListResult;
      return result.pipelines.map((p) => ({ id: p.id, name: p.name }));
    },

    async *runPipeline(
      pipelineId: string | null,
      audioChunks: AsyncIterable<Uint8Array>
    ): AsyncIterable<VoiceResult> {
      const events: VoiceResult[] = [];
      let resolveNext: (() => void) | null = null;
      let done = false;
      let handlerId: number | null = null;

      const unsubscribe = await connection.subscribeMessage(
        (event: { type: string; data?: Record<string, unknown> }) => {
          if (event.type === 'run-start') {
            const stt = event.data?.runner_data as { stt_binary_handler_id?: number } | undefined;
            handlerId = stt?.stt_binary_handler_id ?? null;
          } else if (event.type === 'stt-end') {
            const text = (event.data as { stt_output?: { text?: string } } | undefined)?.stt_output?.text;
            events.push({ stage: 'stt-end', text });
          } else if (event.type === 'intent-end') {
            const text = (
              event.data as { intent_output?: { response?: { speech?: { plain?: { speech?: string } } } } } | undefined
            )?.intent_output?.response?.speech?.plain?.speech;
            events.push({ stage: 'intent-end', text });
          } else if (event.type === 'tts-end') {
            const url = (event.data as { tts_output?: { url?: string } } | undefined)?.tts_output?.url;
            events.push({ stage: 'tts-end', audioUrl: url });
          } else if (event.type === 'error') {
            const message = (event.data as { message?: string } | undefined)?.message ?? 'assist pipeline error';
            events.push({ stage: 'error', error: message });
          } else if (event.type === 'run-end') {
            done = true;
          }
          resolveNext?.();
        },
        {
          type: 'assist_pipeline/run',
          start_stage: 'stt',
          end_stage: 'tts',
          input: { sample_rate: 16000 },
          ...(pipelineId ? { pipeline: pipelineId } : {}),
        }
      );

      try {
        for await (const chunk of audioChunks) {
          if (handlerId === null) continue;
          const framed = new Uint8Array(chunk.length + 1);
          framed[0] = handlerId;
          framed.set(chunk, 1);
          connection.socket.send(framed);
        }
        if (handlerId !== null) {
          connection.socket.send(new Uint8Array([handlerId]));
        }

        while (!done) {
          while (events.length > 0) {
            yield events.shift()!;
          }
          if (done) break;
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
        }
        while (events.length > 0) {
          yield events.shift()!;
        }
      } finally {
        unsubscribe();
      }
    },

    close() {
      connection.close();
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace server test -- voice/client`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/voice/types.ts server/src/voice/client.ts server/src/voice/client.test.ts
git commit -m "feat(voice): add dedicated HA assist-pipeline WS client"
```

---

### Task 3: Voice relay orchestration

**Files:**
- Create: `server/src/voice/relay.ts`
- Test: `server/src/voice/relay.test.ts`

**Interfaces:**
- Consumes: `VoiceHaClient` from Task 2 (`runPipeline`, `listPipelines`)
- Produces: `createVoiceRelay(client: VoiceHaClient): VoiceRelay` where `VoiceRelay = { runUtterance(pipelineId: string | null, audioChunks: AsyncIterable<Uint8Array>, onResult: (r: VoiceResult) => void): Promise<void> }`

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/voice/relay.test.ts
import { describe, it, expect } from 'vitest';
import { createVoiceRelay } from './relay.js';
import type { VoiceHaClient, VoiceResult } from './types.js';

function fakeClient(results: VoiceResult[]): VoiceHaClient {
  return {
    async listPipelines() {
      return [];
    },
    async *runPipeline() {
      for (const r of results) yield r;
    },
    close() {},
  };
}

async function* chunks(): AsyncIterable<Uint8Array> {
  yield new Uint8Array([1, 2, 3]);
}

describe('createVoiceRelay', () => {
  it('forwards every event from the HA client to onResult in order', async () => {
    const results: VoiceResult[] = [
      { stage: 'stt-end', text: 'turn on the lights' },
      { stage: 'intent-end', text: 'Turning on the lights' },
      { stage: 'tts-end', audioUrl: '/api/tts_proxy/abc.mp3' },
    ];
    const relay = createVoiceRelay(fakeClient(results));
    const received: VoiceResult[] = [];
    await relay.runUtterance('pipeline-1', chunks(), (r) => received.push(r));
    expect(received).toEqual(results);
  });

  it('still calls onResult with the error event when the client yields one', async () => {
    const results: VoiceResult[] = [{ stage: 'error', error: 'HA unreachable' }];
    const relay = createVoiceRelay(fakeClient(results));
    const received: VoiceResult[] = [];
    await relay.runUtterance(null, chunks(), (r) => received.push(r));
    expect(received).toEqual(results);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server test -- voice/relay`
Expected: FAIL — `server/src/voice/relay.ts` does not exist.

- [ ] **Step 3: Write `server/src/voice/relay.ts`**

```typescript
// server/src/voice/relay.ts
import type { VoiceHaClient, VoiceResult } from './types.js';

export type VoiceRelay = {
  runUtterance(
    pipelineId: string | null,
    audioChunks: AsyncIterable<Uint8Array>,
    onResult: (r: VoiceResult) => void
  ): Promise<void>;
};

export function createVoiceRelay(client: VoiceHaClient): VoiceRelay {
  return {
    async runUtterance(pipelineId, audioChunks, onResult) {
      try {
        for await (const result of client.runPipeline(pipelineId, audioChunks)) {
          onResult(result);
        }
      } catch (err) {
        onResult({ stage: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace server test -- voice/relay`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/voice/relay.ts server/src/voice/relay.test.ts
git commit -m "feat(voice): add voice relay orchestration"
```

---

### Task 4: `GET /api/ha/assist-pipelines` route

**Files:**
- Create: `server/src/api/ha-assist.ts`
- Modify: `server/src/api/http.ts` (register the route, following the `registerHaEntityRoutes` precedent)
- Test: `server/src/api/ha-assist.test.ts`

**Interfaces:**
- Consumes: `VoiceHaClient.listPipelines()` from Task 2
- Produces: `registerHaAssistRoutes(app: FastifyInstance, deps: { voiceClient: VoiceHaClient | null }): void`; route returns `HaAssistPipeline[]` (empty array if `voiceClient` is `null`)

- [ ] **Step 1: Check how `registerHaEntityRoutes` is wired into `http.ts`**

Run: `grep -n "registerHaEntityRoutes" server/src/api/http.ts`

Use the exact same registration pattern (deps object shape, where in the function body it's called) for `registerHaAssistRoutes`.

- [ ] **Step 2: Write the failing test**

```typescript
// server/src/api/ha-assist.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerHaAssistRoutes } from './ha-assist.js';
import type { VoiceHaClient, HaAssistPipeline } from '../voice/types.js';

function fakeVoiceClient(pipelines: HaAssistPipeline[]): VoiceHaClient {
  return {
    async listPipelines() {
      return pipelines;
    },
    async *runPipeline() {},
    close() {},
  };
}

describe('GET /api/ha/assist-pipelines', () => {
  it('returns pipelines from the voice client', async () => {
    const app = Fastify();
    registerHaAssistRoutes(app, { voiceClient: fakeVoiceClient([{ id: 'p1', name: 'Home' }]) });
    const res = await app.inject({ method: 'GET', url: '/api/ha/assist-pipelines' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 'p1', name: 'Home' }]);
  });

  it('returns an empty array when the voice client is unavailable', async () => {
    const app = Fastify();
    registerHaAssistRoutes(app, { voiceClient: null });
    const res = await app.inject({ method: 'GET', url: '/api/ha/assist-pipelines' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace server test -- ha-assist`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Write `server/src/api/ha-assist.ts`**

```typescript
// server/src/api/ha-assist.ts
import type { FastifyInstance } from 'fastify';
import type { VoiceHaClient } from '../voice/types.js';

export type HaAssistDeps = {
  voiceClient: VoiceHaClient | null;
};

export function registerHaAssistRoutes(app: FastifyInstance, deps: HaAssistDeps): void {
  app.get('/api/ha/assist-pipelines', async () => {
    if (!deps.voiceClient) return [];
    return deps.voiceClient.listPipelines();
  });
}
```

- [ ] **Step 5: Register the route in `server/src/api/http.ts`**

Find the `registerHaEntityRoutes(app, { haClient })` call (or equivalent) in `http.ts` and add immediately after it, threading a new `voiceClient` field through the `HttpDeps` type used by that function:

```typescript
  registerHaAssistRoutes(app, { voiceClient: deps.voiceClient });
```

Add `import { registerHaAssistRoutes } from './ha-assist.js';` near the other route imports, and add `voiceClient: VoiceHaClient | null;` to the `HttpDeps` type (import `VoiceHaClient` from `'../voice/types.js'`).

- [ ] **Step 6: Run test to verify it passes**

Run: `npm --workspace server test -- ha-assist`
Expected: PASS

- [ ] **Step 7: Run full server suite**

Run: `npm --workspace server test`
Expected: PASS (existing `http.ts` tests still pass with the new required `voiceClient` dep — if any existing test constructs `HttpDeps` without it, add `voiceClient: null` there)

- [ ] **Step 8: Commit**

```bash
git add server/src/api/ha-assist.ts server/src/api/ha-assist.test.ts server/src/api/http.ts
git commit -m "feat(voice): add GET /api/ha/assist-pipelines route"
```

---

### Task 5: `PUT /api/displays/:name/voice` route

**Files:**
- Modify: `server/src/api/scenes.ts` or wherever display routes currently live — **check first** (see Step 1)
- Test: same test file as the existing display routes tests

**Interfaces:**
- Consumes: `DisplaysRepo.setVoice` from Task 1
- Produces: `PUT /api/displays/:name/voice` accepting `{ enabled: boolean; pipelineId: string | null }`, responding `200 {ok: true}` or `404` if display not found

- [ ] **Step 1: Locate the existing display routes**

Run: `grep -rn "assign-scene\|setOrientation" server/src/api/*.ts | grep -v test`

This shows which file registers `POST /api/displays/:name/assign-scene` and any orientation-setting route — add the new voice route in that same file, following its exact request/response conventions (param extraction, 404 handling for unknown display name).

- [ ] **Step 2: Write the failing test**

Add to that file's existing test file (same `describe` block style used for other display routes):

```typescript
it('PUT /api/displays/:name/voice updates voice settings', async () => {
  // reuse this file's existing app/repo setup fixture
  const display = displays.registerByName('kitchen');
  const res = await app.inject({
    method: 'PUT',
    url: '/api/displays/kitchen/voice',
    payload: { enabled: true, pipelineId: 'p1' },
  });
  expect(res.statusCode).toBe(200);
  const updated = displays.getById(display.id);
  expect(updated?.voiceEnabled).toBe(true);
  expect(updated?.voicePipelineId).toBe('p1');
});

it('PUT /api/displays/:name/voice 404s for an unknown display', async () => {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/displays/nonexistent/voice',
    payload: { enabled: true, pipelineId: null },
  });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace server test -- <the file located in Step 1>`
Expected: FAIL — route doesn't exist (404 for both, or route-not-found error).

- [ ] **Step 4: Add the route**

In the file located in Step 1, following the exact pattern used by the neighboring display route (e.g. `assign-scene`) for name lookup and 404 handling:

```typescript
  app.put<{ Params: { name: string }; Body: { enabled: boolean; pipelineId: string | null } }>(
    '/api/displays/:name/voice',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      deps.displays.setVoice(display.id, { enabled: req.body.enabled, pipelineId: req.body.pipelineId });
      return { ok: true };
    }
  );
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace server test -- <same file>`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/api/*.ts
git commit -m "feat(voice): add PUT /api/displays/:name/voice route"
```

---

### Task 6: WS hub — inbound voice messages + `pushVoiceResultTo`

**Files:**
- Modify: `server/src/api/ws.ts`
- Modify: `server/src/index.ts` (construct voice client/relay at boot, pass into `WsDeps`)
- Test: `server/src/api/ws.test.ts` (existing file — add to it)

**Interfaces:**
- Consumes: `VoiceRelay.runUtterance` from Task 3
- Produces:
  - `CosmosWss.pushVoiceResultTo(displayId: string, result: VoiceResult): void`
  - Inbound `ClientMessage` extended with `{ type: 'voice_audio'; seq: number; chunk: string; final: boolean } | { type: 'voice_health'; mic: VoiceHealth }`
  - Outbound WS frame: `{ type: 'voice_result', stage, text?, audioUrl?, error? }`

- [ ] **Step 1: Write the failing test**

Add to `server/src/api/ws.test.ts`, following its existing "start a real Fastify on an ephemeral port, connect a real `ws.WebSocket` client" pattern:

```typescript
it('relays voice_audio frames through the voice relay and pushes voice_result back', async () => {
  // Reuse this file's existing helper that boots attachWsHub with a WsDeps fixture
  // and connects + sends {type:'hello', displayName}. After hello completes:
  const results: VoiceResult[] = [{ stage: 'stt-end', text: 'turn on the lights' }];
  const fakeRelay: VoiceRelay = {
    async runUtterance(_pipelineId, _chunks, onResult) {
      for (const r of results) onResult(r);
    },
  };
  // construct wss via attachWsHub(server, { ...baseDeps, voiceRelay: fakeRelay })
  const received: unknown[] = [];
  client.on('message', (data) => received.push(JSON.parse(data.toString())));
  client.send(JSON.stringify({ type: 'voice_audio', seq: 0, chunk: Buffer.from([1, 2, 3]).toString('base64'), final: true }));
  await new Promise((r) => setTimeout(r, 50));
  expect(received).toContainEqual({ type: 'voice_result', stage: 'stt-end', text: 'turn on the lights' });
});
```

(Fill in the exact fixture wiring by matching this file's existing `describe`/`beforeEach` boilerplate for booting `attachWsHub` and connecting a client — do not invent a different pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server test -- api/ws`
Expected: FAIL — `voice_audio` is not a recognized inbound message type yet.

- [ ] **Step 3: Extend `server/src/api/ws.ts`**

Add the import:
```typescript
import type { VoiceRelay } from '../voice/relay.js';
import type { VoiceResult, VoiceHealth } from '../voice/types.js';
```

Extend `WsDeps`:
```typescript
  voiceRelay?: VoiceRelay;
```

Replace the `ClientMessage` type and add a type guard:
```typescript
type ClientMessage =
  | { type: 'hello'; displayName: string }
  | { type: 'voice_audio'; seq: number; chunk: string; final: boolean }
  | { type: 'voice_health'; mic: VoiceHealth };

function isVoiceAudio(value: unknown): value is { type: 'voice_audio'; seq: number; chunk: string; final: boolean } {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'voice_audio';
}

function isVoiceHealth(value: unknown): value is { type: 'voice_health'; mic: VoiceHealth } {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'voice_health';
}
```

Add `pushVoiceResultTo` to the `CosmosWss` type:
```typescript
  pushVoiceResultTo(displayId: string, result: VoiceResult): void;
```

Inside `attachWsHub`, implement it alongside the existing `pushOverlayTo` implementation (same `sockets` map lookup pattern):
```typescript
  wss.pushVoiceResultTo = (displayId, result) => {
    const set = sockets.get(displayId);
    if (!set) return;
    const msg = JSON.stringify({ type: 'voice_result', ...result });
    for (const s of set) {
      if (s.readyState === s.OPEN) {
        try { s.send(msg); } catch { /* socket dying — close handler cleans up */ }
      }
    }
  };
```

In the per-connection `message` handler (where `isHello` is currently checked), add branches for the new message types, using a per-connection audio buffer to collect chunks until `final: true`, then invoke the relay:

```typescript
    } else if (isVoiceAudio(parsed)) {
      if (!deps.voiceRelay || !displayId) return;
      voiceAudioBuffers.get(ws)?.push(Buffer.from(parsed.chunk, 'base64')) ??
        voiceAudioBuffers.set(ws, [Buffer.from(parsed.chunk, 'base64')]);
      if (parsed.final) {
        const chunks = voiceAudioBuffers.get(ws) ?? [];
        voiceAudioBuffers.delete(ws);
        const display = deps.displays.getById(displayId);
        const pipelineId = display?.voicePipelineId ?? null;
        async function* toAsyncIter() {
          for (const c of chunks) yield new Uint8Array(c);
        }
        deps.voiceRelay.runUtterance(pipelineId, toAsyncIter(), (result) => {
          wss.pushVoiceResultTo(displayId!, result);
        });
      }
    } else if (isVoiceHealth(parsed)) {
      if (displayId) lastVoiceHealthByDisplay.set(displayId, parsed.mic);
    }
```

Declare `voiceAudioBuffers` and `lastVoiceHealthByDisplay` maps alongside the existing `sockets`/`lastSceneByDisplay` maps at the top of `attachWsHub`:
```typescript
  const voiceAudioBuffers = new Map<WebSocket, Buffer[]>();
  const lastVoiceHealthByDisplay = new Map<string, VoiceHealth>();
```

Expose `lastVoiceHealthByDisplay` reads via a small accessor on `CosmosWss` for the admin status readout:
```typescript
  getVoiceHealth(displayId: string): VoiceHealth | null;
```
implemented as `wss.getVoiceHealth = (displayId) => lastVoiceHealthByDisplay.get(displayId) ?? null;`

- [ ] **Step 4: Wire the voice client + relay in `server/src/index.ts`**

Find where `haClient` is constructed (via `makeHaClient`) and, immediately after, construct the voice client the same way, tolerating failure (voice becomes unavailable, not fatal to boot):

```typescript
let voiceClient: VoiceHaClient | null = null;
let voiceRelay: VoiceRelay | undefined;
if (config.haUrl && config.haToken) {
  try {
    voiceClient = await makeVoiceHaClient({ url: config.haUrl, token: config.haToken });
    voiceRelay = createVoiceRelay(voiceClient);
  } catch (err) {
    console.error('[voice] failed to connect HA assist client', err);
  }
}
```

(Match the exact `config.haUrl`/`config.haToken` field names already used for the primary `haClient` construction in this file.) Pass `voiceClient` into the `HttpDeps` used by `registerHaAssistRoutes` (Task 4) and `voiceRelay` into `WsDeps` passed to `attachWsHub`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace server test -- api/ws`
Expected: PASS

- [ ] **Step 6: Run full server suite**

Run: `npm --workspace server test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/api/ws.ts server/src/index.ts server/src/api/ws.test.ts
git commit -m "feat(voice): relay voice_audio over the WS hub to HA assist"
```

---

### Task 7: Display-side WS protocol extension

**Files:**
- Modify: `display/src/lib/ws.ts`
- Test: `display/src/lib/ws.test.ts` (create if none exists — check first)

**Interfaces:**
- Produces:
  - `VoiceResultMessage = { type: 'voice_result'; stage: 'listening' | 'stt-end' | 'intent-end' | 'tts-end' | 'error'; text?: string; audioUrl?: string; error?: string }`
  - `ServerMessage` union extended with `VoiceResultMessage`
  - `CosmosConnection.sendVoiceAudio(seq: number, chunk: Uint8Array, final: boolean): void`
  - `CosmosConnection.sendVoiceHealth(mic: 'ok' | 'permission_denied' | 'model_load_failed' | 'idle' | 'error'): void`

- [ ] **Step 1: Check for existing ws tests**

Run: `ls display/src/lib/ws.test.ts 2>/dev/null || echo none`

- [ ] **Step 2: Write the failing test**

```typescript
// display/src/lib/ws.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { wasClean: boolean }) => void) | null = null;
  sent: string[] = [];
  sentBinary: unknown[] = [];
  constructor() {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(evt: string, cb: (e?: unknown) => void) {
    if (evt === 'open') this.onopen = cb as () => void;
    if (evt === 'message') this.onmessage = cb as (e: { data: string }) => void;
    if (evt === 'error') this.onerror = cb as () => void;
    if (evt === 'close') this.onclose = cb as (e: { wasClean: boolean }) => void;
  }
  send(data: string | ArrayBuffer) {
    if (typeof data === 'string') this.sent.push(data);
    else this.sentBinary.push(data);
  }
  close() {}
}

describe('voice WS extensions', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    (globalThis as unknown as { window: unknown }).window = {
      location: { protocol: 'http:', host: 'localhost:8099' },
    };
  });

  it('sendVoiceAudio sends a base64-encoded voice_audio frame', async () => {
    const { connect } = await import('./ws.js');
    const conn = connect('kitchen', () => {});
    const sock = FakeWebSocket.instances[0];
    sock.onopen?.();
    conn.sendVoiceAudio(0, new Uint8Array([1, 2, 3]), true);
    const frame = JSON.parse(sock.sent[sock.sent.length - 1]);
    expect(frame.type).toBe('voice_audio');
    expect(frame.seq).toBe(0);
    expect(frame.final).toBe(true);
    expect(typeof frame.chunk).toBe('string');
  });

  it('sendVoiceHealth sends a voice_health frame', async () => {
    const { connect } = await import('./ws.js');
    const conn = connect('kitchen', () => {});
    const sock = FakeWebSocket.instances[0];
    sock.onopen?.();
    conn.sendVoiceHealth('permission_denied');
    const frame = JSON.parse(sock.sent[sock.sent.length - 1]);
    expect(frame).toEqual({ type: 'voice_health', mic: 'permission_denied' });
  });

  it('dispatches a voice_result message to onMessage', async () => {
    const { connect } = await import('./ws.js');
    const received: unknown[] = [];
    const conn = connect('kitchen', (msg) => received.push(msg));
    const sock = FakeWebSocket.instances[0];
    sock.onopen?.();
    sock.onmessage?.({ data: JSON.stringify({ type: 'voice_result', stage: 'stt-end', text: 'hi' }) });
    expect(received).toContainEqual({ type: 'voice_result', stage: 'stt-end', text: 'hi' });
    conn.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace display test -- ws`
Expected: FAIL — `sendVoiceAudio`/`sendVoiceHealth` don't exist.

- [ ] **Step 4: Extend `display/src/lib/ws.ts`**

Add the new message type and extend the union:
```typescript
export type VoiceResultMessage = {
  type: 'voice_result';
  stage: 'listening' | 'stt-end' | 'intent-end' | 'tts-end' | 'error';
  text?: string;
  audioUrl?: string;
  error?: string;
};
export type ServerMessage =
  | WelcomeMessage
  | DisplayConfigMessage
  | SceneMessage
  | OverlayPushMessage
  | OverlayDismissMessage
  | ErrorMessage
  | PingMessage
  | VoiceResultMessage;
```

Extend `CosmosConnection`:
```typescript
export type CosmosConnection = {
  close(): void;
  sendVoiceAudio(seq: number, chunk: Uint8Array, final: boolean): void;
  sendVoiceHealth(mic: 'ok' | 'permission_denied' | 'model_load_failed' | 'idle' | 'error'): void;
};
```

In `connect()`, add a small base64 helper and the two send methods to the returned object (next to the existing `close()`):
```typescript
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
```
```typescript
  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (livenessTimer) clearTimeout(livenessTimer);
      socket?.close();
    },
    sendVoiceAudio(seq, chunk, final) {
      socket?.send(JSON.stringify({ type: 'voice_audio', seq, chunk: toBase64(chunk), final }));
    },
    sendVoiceHealth(mic) {
      socket?.send(JSON.stringify({ type: 'voice_health', mic }));
    },
  };
```
(Preserve whatever the existing `close()` body already does — shown above matching the current file; do not change its behavior, only add the two new methods alongside it.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace display test -- ws`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add display/src/lib/ws.ts display/src/lib/ws.test.ts
git commit -m "feat(voice): extend display WS client with voice_audio/voice_result"
```

---

### Task 8: Utterance capture (silence/timeout buffering)

**Files:**
- Create: `display/src/lib/voice/types.ts`
- Create: `display/src/lib/voice/capture.ts`
- Test: `display/src/lib/voice/capture.test.ts`

**Interfaces:**
- Produces: `createUtteranceCapture(opts: { onChunk: (seq: number, chunk: Uint8Array, final: boolean) => void; silenceMs?: number; maxMs?: number }): { pushFrame(frame: Int16Array, rmsThreshold?: number): void; reset(): void }`

- [ ] **Step 1: Write `display/src/lib/voice/types.ts`**

```typescript
// display/src/lib/voice/types.ts
export type VoiceHealthStatus = 'ok' | 'permission_denied' | 'model_load_failed' | 'idle' | 'error';

export type VoiceOverlayState = 'idle' | 'listening' | 'thinking' | 'response' | 'error';
```

- [ ] **Step 2: Write the failing test**

```typescript
// display/src/lib/voice/capture.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createUtteranceCapture } from './capture.js';

function silentFrame(n = 320): Int16Array {
  return new Int16Array(n); // all zeros -> RMS 0, below any threshold
}

function loudFrame(n = 320): Int16Array {
  const f = new Int16Array(n);
  f.fill(10000);
  return f;
}

describe('createUtteranceCapture', () => {
  it('buffers frames and does not emit until silence timeout after speech', () => {
    vi.useFakeTimers();
    const onChunk = vi.fn();
    const capture = createUtteranceCapture({ onChunk, silenceMs: 500, maxMs: 5000 });
    capture.pushFrame(loudFrame());
    expect(onChunk).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    capture.pushFrame(silentFrame());
    vi.advanceTimersByTime(600);
    expect(onChunk).toHaveBeenCalled();
    const lastCall = onChunk.mock.calls[onChunk.mock.calls.length - 1];
    expect(lastCall[2]).toBe(true); // final chunk
    vi.useRealTimers();
  });

  it('force-ends at maxMs even with continuous speech', () => {
    vi.useFakeTimers();
    const onChunk = vi.fn();
    const capture = createUtteranceCapture({ onChunk, silenceMs: 500, maxMs: 1000 });
    capture.pushFrame(loudFrame());
    vi.advanceTimersByTime(1100);
    capture.pushFrame(loudFrame());
    expect(onChunk).toHaveBeenCalled();
    const lastCall = onChunk.mock.calls[onChunk.mock.calls.length - 1];
    expect(lastCall[2]).toBe(true);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace display test -- voice/capture`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Write `display/src/lib/voice/capture.ts`**

```typescript
// display/src/lib/voice/capture.ts
export type UtteranceCaptureOpts = {
  onChunk: (seq: number, chunk: Uint8Array, final: boolean) => void;
  /** Silence duration (ms) after speech before the utterance is considered done. Default 800. */
  silenceMs?: number;
  /** Hard cap (ms) on total utterance length regardless of silence. Default 5000. */
  maxMs?: number;
  /** RMS below this is treated as silence. Default 500 (int16 scale). */
  rmsThreshold?: number;
};

export type UtteranceCapture = {
  pushFrame(frame: Int16Array): void;
  reset(): void;
};

function rms(frame: Int16Array): number {
  let sum = 0;
  for (const s of frame) sum += s * s;
  return Math.sqrt(sum / frame.length);
}

function toBytes(frame: Int16Array): Uint8Array {
  return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
}

export function createUtteranceCapture(opts: UtteranceCaptureOpts): UtteranceCapture {
  const silenceMs = opts.silenceMs ?? 800;
  const maxMs = opts.maxMs ?? 5000;
  const rmsThreshold = opts.rmsThreshold ?? 500;

  let seq = 0;
  let speaking = false;
  let elapsedMs = 0;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  function finish() {
    if (!speaking) return;
    speaking = false;
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
    opts.onChunk(seq++, new Uint8Array(0), true);
    elapsedMs = 0;
  }

  return {
    pushFrame(frame: Int16Array) {
      const level = rms(frame);
      const isSpeech = level >= rmsThreshold;

      if (!speaking && isSpeech) {
        speaking = true;
        elapsedMs = 0;
        maxTimer = setTimeout(finish, maxMs);
      }

      if (speaking) {
        opts.onChunk(seq, toBytes(frame), false);
        if (silenceTimer) clearTimeout(silenceTimer);
        if (!isSpeech) {
          silenceTimer = setTimeout(finish, silenceMs);
        }
      }
    },
    reset() {
      speaking = false;
      elapsedMs = 0;
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace display test -- voice/capture`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add display/src/lib/voice/types.ts display/src/lib/voice/capture.ts display/src/lib/voice/capture.test.ts
git commit -m "feat(voice): add utterance capture with silence/timeout buffering"
```

---

### Task 9: Wake-word detector

**Files:**
- Create: `display/src/lib/voice/wakeword.ts`
- Test: `display/src/lib/voice/wakeword.test.ts`
- Asset (not authored by this task — see note): `display/static/voice/wakeword.onnx`

**Interfaces:**
- Consumes: `onnxruntime-web` (add as a `display/` dependency)
- Produces: `createWakeWordDetector(opts: { onWake: () => void; modelUrl?: string; threshold?: number }): { processFrame(frame: Float32Array): Promise<void>; load(): Promise<void>; dispose(): void }`

**Note on the model asset:** the actual openWakeWord `.onnx` model binary is a build asset (like the mood `.mp4` files), not source code — it must be exported from the Python `openwakeword` package and placed at `display/static/voice/wakeword.onnx` separately from this plan. This task implements the loader/inference wrapper against that expected path and is testable by injecting a fake ONNX session, independent of whether the real asset is present yet.

- [ ] **Step 1: Add the `onnxruntime-web` dependency**

Run: `npm --workspace display install onnxruntime-web`

- [ ] **Step 2: Write the failing test**

```typescript
// display/src/lib/voice/wakeword.test.ts
import { describe, it, expect, vi } from 'vitest';

const fakeSession = {
  run: vi.fn(async () => ({ output: { data: new Float32Array([0.9]) } })),
};

vi.mock('onnxruntime-web', () => ({
  InferenceSession: { create: vi.fn(async () => fakeSession) },
  Tensor: class {
    constructor(public type: string, public data: Float32Array, public dims: number[]) {}
  },
}));

describe('createWakeWordDetector', () => {
  it('fires onWake when inference score exceeds the threshold', async () => {
    const { createWakeWordDetector } = await import('./wakeword.js');
    const onWake = vi.fn();
    const detector = createWakeWordDetector({ onWake, modelUrl: '/voice/wakeword.onnx', threshold: 0.5 });
    await detector.load();
    await detector.processFrame(new Float32Array(1280));
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('does not fire when inference score is below the threshold', async () => {
    fakeSession.run.mockResolvedValueOnce({ output: { data: new Float32Array([0.1]) } });
    const { createWakeWordDetector } = await import('./wakeword.js');
    const onWake = vi.fn();
    const detector = createWakeWordDetector({ onWake, modelUrl: '/voice/wakeword.onnx', threshold: 0.5 });
    await detector.load();
    await detector.processFrame(new Float32Array(1280));
    expect(onWake).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace display test -- voice/wakeword`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Write `display/src/lib/voice/wakeword.ts`**

```typescript
// display/src/lib/voice/wakeword.ts
import { InferenceSession, Tensor } from 'onnxruntime-web';

export type WakeWordDetectorOpts = {
  onWake: () => void;
  modelUrl?: string;
  threshold?: number;
};

export type WakeWordDetector = {
  load(): Promise<void>;
  processFrame(frame: Float32Array): Promise<void>;
  dispose(): void;
};

export function createWakeWordDetector(opts: WakeWordDetectorOpts): WakeWordDetector {
  const modelUrl = opts.modelUrl ?? '/voice/wakeword.onnx';
  const threshold = opts.threshold ?? 0.5;
  let session: InferenceSession | null = null;

  return {
    async load() {
      session = await InferenceSession.create(modelUrl);
    },
    async processFrame(frame: Float32Array) {
      if (!session) return;
      const tensor = new Tensor('float32', frame, [1, frame.length]);
      const results = await session.run({ input: tensor } as unknown as Record<string, Tensor>);
      const score = (results.output.data as Float32Array)[0];
      if (score >= threshold) opts.onWake();
    },
    dispose() {
      session = null;
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace display test -- voice/wakeword`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add display/package.json display/src/lib/voice/wakeword.ts display/src/lib/voice/wakeword.test.ts
git commit -m "feat(voice): add ONNX-based wake-word detector"
```

---

### Task 10: Voice assistant wiring (mic capture → WS → overlay/playback)

**Files:**
- Create: `display/src/lib/voice/index.ts`
- Test: `display/src/lib/voice/index.test.ts`

**Interfaces:**
- Consumes: `CosmosConnection` (Task 7), `createWakeWordDetector` (Task 9), `createUtteranceCapture` (Task 8), `VoiceOverlayState` (Task 8)
- Produces: `startVoiceAssistant(connection: CosmosConnection, onOverlayState: (state: VoiceOverlayState, text?: string) => void): { stop(): void }`

- [ ] **Step 1: Write the failing test**

This task's browser-audio glue (`getUserMedia`, `AudioWorklet`) is not itself unit-testable without a real browser; the test verifies the *orchestration* — given fake wake-word/capture modules and a fake connection, wake → capture-final → `voice_audio` sent, and `voice_result` messages drive `onOverlayState` correctly, and a `tts-end` triggers audio playback via an injectable player.

```typescript
// display/src/lib/voice/index.test.ts
import { describe, it, expect, vi } from 'vitest';
import { startVoiceAssistant } from './index.js';
import type { CosmosConnection, ServerMessage } from '../ws.js';

describe('startVoiceAssistant', () => {
  it('drives overlay state through listening -> thinking -> response on voice_result events', () => {
    let messageHandler: ((msg: ServerMessage) => void) | null = null;
    const sendVoiceAudio = vi.fn();
    const connection: CosmosConnection = {
      close: vi.fn(),
      sendVoiceAudio,
      sendVoiceHealth: vi.fn(),
    };
    const states: [string, string | undefined][] = [];
    const playAudio = vi.fn();

    const handle = startVoiceAssistant(connection, (state, text) => states.push([state, text]), {
      onServerMessage: (fn) => {
        messageHandler = fn;
      },
      playAudio,
    });

    messageHandler?.({ type: 'voice_result', stage: 'stt-end', text: 'turn on the lights' });
    messageHandler?.({ type: 'voice_result', stage: 'intent-end', text: 'Turning on the lights' });
    messageHandler?.({ type: 'voice_result', stage: 'tts-end', audioUrl: '/api/tts/abc.mp3' });

    expect(states).toEqual([
      ['thinking', 'turn on the lights'],
      ['thinking', 'Turning on the lights'],
      ['response', 'Turning on the lights'],
    ]);
    expect(playAudio).toHaveBeenCalledWith('/api/tts/abc.mp3');

    handle.stop();
  });

  it('surfaces an error voice_result as the error overlay state', () => {
    let messageHandler: ((msg: ServerMessage) => void) | null = null;
    const connection: CosmosConnection = { close: vi.fn(), sendVoiceAudio: vi.fn(), sendVoiceHealth: vi.fn() };
    const states: [string, string | undefined][] = [];

    const handle = startVoiceAssistant(connection, (state, text) => states.push([state, text]), {
      onServerMessage: (fn) => {
        messageHandler = fn;
      },
      playAudio: vi.fn(),
    });

    messageHandler?.({ type: 'voice_result', stage: 'error', error: 'HA unreachable' });
    expect(states).toEqual([['error', 'HA unreachable']]);
    handle.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace display test -- voice/index`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `display/src/lib/voice/index.ts`**

```typescript
// display/src/lib/voice/index.ts
import type { CosmosConnection, ServerMessage } from '../ws.js';
import type { VoiceOverlayState } from './types.js';

export type VoiceAssistantDeps = {
  /** Registers a callback for inbound server messages; returns nothing, callback fires per message. */
  onServerMessage: (fn: (msg: ServerMessage) => void) => void;
  /** Plays a TTS response through the kiosk's speakers. Defaults to a real <audio> element. */
  playAudio?: (url: string) => void;
};

export type VoiceAssistantHandle = {
  stop(): void;
};

function defaultPlayAudio(url: string): void {
  const audio = new Audio(url);
  void audio.play();
}

export function startVoiceAssistant(
  connection: CosmosConnection,
  onOverlayState: (state: VoiceOverlayState, text?: string) => void,
  deps: VoiceAssistantDeps
): VoiceAssistantHandle {
  const playAudio = deps.playAudio ?? defaultPlayAudio;

  deps.onServerMessage((msg) => {
    if (msg.type !== 'voice_result') return;
    switch (msg.stage) {
      case 'listening':
        onOverlayState('listening');
        break;
      case 'stt-end':
      case 'intent-end':
        onOverlayState('thinking', msg.text);
        break;
      case 'tts-end':
        onOverlayState('response', msg.text);
        if (msg.audioUrl) playAudio(msg.audioUrl);
        break;
      case 'error':
        onOverlayState('error', msg.error);
        break;
    }
  });

  return {
    stop() {
      connection.sendVoiceHealth('idle');
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace display test -- voice/index`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add display/src/lib/voice/index.ts display/src/lib/voice/index.test.ts
git commit -m "feat(voice): wire voice_result events to overlay state and TTS playback"
```

---

### Task 11: Mic capture + wake-word bootstrap in the kiosk shell

**Files:**
- Modify: whichever route file currently reads `DisplayConfigMessage` and establishes the WS `connect()` call — **locate first** (see Step 1)
- Test: manual (browser mic/AudioWorklet paths are not unit-testable in this suite; covered by the spec's manual smoke test)

**Interfaces:**
- Consumes: `startVoiceAssistant` (Task 10), `createWakeWordDetector` (Task 9), `createUtteranceCapture` (Task 8), `DisplayConfig.voiceEnabled` (already on `DisplayConfig` per `ws.ts`)

- [ ] **Step 1: Find where the kiosk mounts the WS connection and reacts to `display_config`**

Run: `grep -rln "connect(" display/src/routes | grep -v test`

Open that file and confirm where `DisplayConfigMessage` (`msg.type === 'display_config'`) is currently handled — this is the mount point for voice bootstrap.

- [ ] **Step 2: Add voice bootstrap gated on `voiceEnabled`**

In that file, after mic/model setup imports are added (`createWakeWordDetector`, `createUtteranceCapture`, `startVoiceAssistant`), add logic that, on receiving a `display_config` message with `config.orientation` (existing) also checks a new `config.voiceEnabled` (extend `DisplayConfig` in `ws.ts` with `voiceEnabled: boolean` and `voicePipelineId: string | null` — mirroring the additive-union-extension approach used throughout this plan), and if true:

```typescript
  let micStream: MediaStream | null = null;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    connection.sendVoiceHealth('permission_denied');
    return;
  }

  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const source = audioCtx.createMediaStreamSource(micStream);

  const capture = createUtteranceCapture({
    onChunk: (seq, chunk, final) => connection.sendVoiceAudio(seq, chunk, final),
  });

  const detector = createWakeWordDetector({
    onWake: () => {
      overlayState = 'listening';
      updateOverlay(overlayState);
    },
  });

  try {
    await detector.load();
  } catch {
    connection.sendVoiceHealth('model_load_failed');
    return;
  }

  const processor = audioCtx.createScriptProcessor(1280, 1, 1);
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    void detector.processFrame(input);
    const int16 = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) int16[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
    capture.pushFrame(int16);
  };
  source.connect(processor);
  processor.connect(audioCtx.destination);

  connection.sendVoiceHealth('ok');

  startVoiceAssistant(connection, updateOverlay, {
    onServerMessage: (fn) => registerVoiceResultHandler(fn), // hook into this file's existing onMessage dispatch for 'voice_result'
  });
```

(`updateOverlay` and `registerVoiceResultHandler` should be small local functions in this file that route into the existing overlay-rendering mechanism already used for `OverlayPushMessage` — reuse it rather than building a second overlay renderer.)

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, open `http://localhost:5173`, enable voice for a display in `/admin` (once Task 12 lands), grant mic permission when prompted, confirm no console errors and that `voice_health: 'ok'` round-trips (check via `LOG_PUSHES`-style server log or a temporary `console.log` in the WS hub's `voice_health` branch, removed before commit).

- [ ] **Step 4: Commit**

```bash
git add display/src/lib/ws.ts display/src/routes/**/*.svelte
git commit -m "feat(voice): bootstrap mic capture and wake-word listening in the kiosk shell"
```

---

### Task 12: Admin UI — voice toggle, pipeline picker, status readout

**Files:**
- Modify: `display/src/lib/admin/api.ts`
- Modify: `display/src/routes/admin/displays/+page.svelte`
- Test: `display/src/lib/admin/api.test.ts` (existing file — add to it; check first)

**Interfaces:**
- Consumes: `PUT /api/displays/:name/voice` (Task 5), `GET /api/ha/assist-pipelines` (Task 4)
- Produces: `api.displays.setVoice(displayName: string, opts: { enabled: boolean; pipelineId: string | null }): Promise<void>`, `api.ha.listAssistPipelines(): Promise<{id: string; name: string}[]>`

- [ ] **Step 1: Check the existing admin api test file's pattern**

Run: `grep -n "setOrientation" display/src/lib/admin/api.test.ts`

Match its fetch-mocking style exactly for the new tests.

- [ ] **Step 2: Write the failing test**

```typescript
// added to display/src/lib/admin/api.test.ts
it('setVoice PUTs to /api/displays/:name/voice', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetchMock);
  await api.displays.setVoice('kitchen', { enabled: true, pipelineId: 'p1' });
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/displays/kitchen/voice',
    expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enabled: true, pipelineId: 'p1' }) })
  );
});

it('listAssistPipelines GETs /api/ha/assist-pipelines', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'p1', name: 'Home' }] });
  vi.stubGlobal('fetch', fetchMock);
  const pipelines = await api.ha.listAssistPipelines();
  expect(pipelines).toEqual([{ id: 'p1', name: 'Home' }]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace display test -- admin/api`
Expected: FAIL — `setVoice`/`listAssistPipelines` don't exist.

- [ ] **Step 4: Add the methods to `display/src/lib/admin/api.ts`**

Next to `setOrientation` in the `displays` namespace:
```typescript
    async setVoice(displayName: string, opts: { enabled: boolean; pipelineId: string | null }): Promise<void> {
      await fetch(`/api/displays/${displayName}/voice`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
    },
```

Add a `ha` namespace (or extend an existing one if `api.ts` already groups HA-related calls — check first with `grep -n "^  ha\|export const ha" display/src/lib/admin/api.ts`):
```typescript
  ha: {
    async listAssistPipelines(): Promise<{ id: string; name: string }[]> {
      const res = await fetch('/api/ha/assist-pipelines');
      return res.json();
    },
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace display test -- admin/api`
Expected: PASS

- [ ] **Step 6: Add the UI fieldset to `display/src/routes/admin/displays/+page.svelte`**

In the per-row expand panel (near the existing orientation `<select>`), add:

```svelte
<div class="field">
  <label class="tag" for={`voice-${display.id}`}>Voice assistant</label>
  <input
    id={`voice-${display.id}`}
    type="checkbox"
    checked={display.voiceEnabled}
    on:change={(e) => handleSetVoice(display, (e.target as HTMLInputElement).checked)}
  />
  {#if display.voiceEnabled}
    <select
      value={display.voicePipelineId ?? ''}
      on:change={(e) => handleSetVoicePipeline(display, (e.target as HTMLSelectElement).value || null)}
    >
      <option value="">HA default pipeline</option>
      {#each assistPipelines as p}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>
    <span class="tag">mic: {display.micHealth ?? 'unknown'}</span>
  {/if}
</div>
```

Add corresponding script-block state and handlers, following the existing `handleSetOrientation`-style pattern already in this file:
```typescript
let assistPipelines: { id: string; name: string }[] = [];
onMount(async () => {
  assistPipelines = await api.ha.listAssistPipelines();
});

async function handleSetVoice(display: Display, enabled: boolean) {
  await api.displays.setVoice(display.name, { enabled, pipelineId: display.voicePipelineId });
  await refreshDisplays(); // reuse this file's existing reload-after-mutation helper
}

async function handleSetVoicePipeline(display: Display, pipelineId: string | null) {
  await api.displays.setVoice(display.name, { enabled: display.voiceEnabled, pipelineId });
  await refreshDisplays();
}
```

(Match the exact name of this file's existing "reload the displays list after a mutation" helper — do not invent a new one if `handleSetOrientation` already calls something equivalent.)

- [ ] **Step 7: Manual verification**

Run `npm run dev`, open `http://localhost:5173/admin/displays`, expand a display row, toggle voice on, pick a pipeline from the dropdown, confirm the toggle/selection persists after a page reload (i.e. round-trips through the server).

- [ ] **Step 8: Commit**

```bash
git add display/src/lib/admin/api.ts display/src/lib/admin/api.test.ts display/src/routes/admin/displays/+page.svelte
git commit -m "feat(voice): add admin voice toggle and pipeline picker to Displays page"
```

---

### Task 13: End-to-end regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full server suite**

Run: `npm --workspace server test`
Expected: PASS, no regressions in existing scenes/ws/moods/overlay/mqtt tests.

- [ ] **Step 2: Run the full display suite**

Run: `npm --workspace display test`
Expected: PASS.

- [ ] **Step 3: Run the full build**

Run: `npm run build`
Expected: succeeds — confirms the new `onnxruntime-web` dependency and new TS files type-check and bundle cleanly.

- [ ] **Step 4: Manual smoke test with voice disabled (default)**

Run `npm run dev`, confirm a display with `voice_enabled = false` shows no mic prompt, no console errors, and all existing scene/transition/overlay/mood behavior is unaffected.

- [ ] **Step 5: Commit (only if any fixes were needed in this task)**

```bash
git add -A
git commit -m "fix(voice): address regressions found in end-to-end pass"
```
