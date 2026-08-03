import type { VoiceHaClient, VoiceResult } from './types.js';

export type VoiceRelay = {
  runUtterance(
    pipelineId: string | null,
    audioChunks: AsyncIterable<Uint8Array>,
    onResult: (r: VoiceResult) => void
  ): Promise<void>;
};

export type VoiceRelayOpts = {
  /** Hard cap (ms) on one utterance's total HA round-trip. Guards against
   *  `client.runPipeline` hanging forever if HA emits a terminal error (or
   *  just goes silent) without ever sending run-end. Overridable for tests;
   *  defaults to 30s in production. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export function createVoiceRelay(client: VoiceHaClient, opts: VoiceRelayOpts = {}): VoiceRelay {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async runUtterance(pipelineId, audioChunks, onResult) {
      const iterator = client.runPipeline(pipelineId, audioChunks)[Symbol.asyncIterator]();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeoutSignal = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, timeoutMs);
      });

      try {
        while (!timedOut) {
          const raced = await Promise.race([
            iterator.next().then((r) => ({ kind: 'next' as const, result: r })),
            timeoutSignal.then(() => ({ kind: 'timeout' as const })),
          ]);
          if (raced.kind === 'timeout') {
            onResult({ stage: 'error', error: 'voice pipeline timed out' });
            break;
          }
          if (raced.result.done) break;
          onResult(raced.result.value);
        }
      } catch (err) {
        if (!timedOut) onResult({ stage: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
