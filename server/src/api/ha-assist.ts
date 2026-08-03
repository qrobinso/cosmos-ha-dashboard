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
