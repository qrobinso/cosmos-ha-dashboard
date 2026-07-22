// home-assistant-js-websocket reads globalThis.WebSocket. In Node 20 that
// global isn't defined (it's experimental), so we polyfill with ws before
// the library is loaded. See ha/client.ts for the same pattern — this is a
// dedicated second HA connection so a long voice interaction can't block
// the reactive entity-state connection.
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
          connection.socket!.send(framed);
        }
        if (handlerId !== null) {
          connection.socket!.send(new Uint8Array([handlerId]));
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
