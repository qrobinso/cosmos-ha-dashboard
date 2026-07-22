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
