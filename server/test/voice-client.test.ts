import { describe, it, expect, vi } from 'vitest';
import { makeVoiceHaClient } from '../src/voice/client.js';

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
