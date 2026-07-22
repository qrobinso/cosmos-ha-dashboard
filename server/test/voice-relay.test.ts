import { describe, it, expect } from 'vitest';
import { createVoiceRelay } from '../src/voice/relay.js';
import type { VoiceHaClient, VoiceResult } from '../src/voice/types.js';

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
