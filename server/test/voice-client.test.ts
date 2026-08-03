import { describe, it, expect, vi } from 'vitest';
import { createConnection } from 'home-assistant-js-websocket';
import { makeVoiceHaClient } from '../src/voice/client.js';
import type { VoiceResult } from '../src/voice/types.js';

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

  // Regression for the handlerId race: `subscribeMessage` resolving (the
  // subscribe COMMAND's ack) does not mean HA's pipeline `run-start` EVENT
  // (which carries `stt_binary_handler_id`) has arrived yet — that lands as
  // a later message on the same subscription callback. runPipeline's send
  // loop must wait for it instead of racing ahead and silently dropping
  // every audio chunk (handlerId still null).
  it('waits for run-start before sending audio, instead of racing ahead and dropping chunks', async () => {
    const sent: Uint8Array[] = [];
    let deliverEvent: ((event: { type: string; data?: Record<string, unknown> }) => void) | null = null;

    vi.mocked(createConnection).mockImplementationOnce(
      async () =>
        ({
          sendMessagePromise: vi.fn(async () => ({})),
          subscribeMessage: vi.fn(async (cb: (event: { type: string; data?: Record<string, unknown> }) => void) => {
            deliverEvent = cb;
            // Simulate the real HA timing: the subscribe COMMAND's ack (this
            // promise) resolves well before the pipeline's own run-start
            // EVENT arrives on a later WS frame. Deliver it asynchronously,
            // after runPipeline's send loop would already be running under
            // the pre-fix code (which starts iterating audioChunks the
            // instant this promise settles).
            setTimeout(() => {
              deliverEvent?.({ type: 'run-start', data: { runner_data: { stt_binary_handler_id: 7 } } });
              setTimeout(() => deliverEvent?.({ type: 'run-end' }), 5);
            }, 20);
            return () => {};
          }),
          socket: { send: vi.fn((data: Uint8Array) => sent.push(data)) },
          close: vi.fn(),
        }) as unknown as Awaited<ReturnType<typeof createConnection>>
    );

    const client = await makeVoiceHaClient({ url: 'http://ha.local:8123', token: 'tok' });

    async function* chunks() {
      yield new Uint8Array([9, 9, 9]);
    }

    const results: VoiceResult[] = [];
    for await (const r of client.runPipeline('p1', chunks())) {
      results.push(r);
    }

    // Exactly two sends: the framed audio chunk, then the handler-id-only
    // end marker. Under the pre-fix race, both would be skipped entirely
    // (handlerId was still null when the loop ran) and `sent` would be empty.
    expect(sent.length).toBe(2);
    expect(sent[0][0]).toBe(7); // first byte = handlerId
    expect(Array.from(sent[0].slice(1))).toEqual([9, 9, 9]);
    expect(Array.from(sent[1])).toEqual([7]); // end-of-audio marker

    client.close();
  });
});
