import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerHaAssistRoutes } from '../src/api/ha-assist.js';
import type { VoiceHaClient, HaAssistPipeline } from '../src/voice/types.js';

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
