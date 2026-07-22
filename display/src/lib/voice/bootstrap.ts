import type { CosmosConnection, ServerMessage } from '../ws';
import type { VoiceOverlayState } from './types';
import type { WakeWordDetector } from './wakeword';

export type VoiceBootstrapHandle = {
  /** Forwards an inbound `voice_result` server message into the voice assistant pipeline. */
  handleServerMessage(msg: ServerMessage): void;
  /** Releases the mic stream, audio graph, and wake-word model. */
  stop(): Promise<void>;
};

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

/**
 * Arms the mic + wake-word pipeline for a voice-enabled kiosk display.
 *
 * This module (and everything it dynamically imports below) is loaded lazily —
 * callers MUST reach it via `await import('$lib/voice/bootstrap')`, never a
 * static top-level import, since `wakeword.ts` pulls in onnxruntime-web's
 * ~26MB WASM runtime. Loading it eagerly would bloat every kiosk boot even on
 * displays that never use voice.
 *
 * Silent-degrade per the design spec: permission or model-load failures report
 * health to the server and leave the kiosk otherwise idle — no on-screen error.
 */
export async function startVoiceBootstrap(
  connection: CosmosConnection,
  onOverlayState: (state: VoiceOverlayState, text?: string) => void
): Promise<VoiceBootstrapHandle | null> {
  let micStream: MediaStream;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    connection.sendVoiceHealth('permission_denied');
    return null;
  }

  // From here on the mic is hot: any thrown error in this region (a transient
  // network failure fetching the ~26MB wakeword WASM chunk, an unsupported
  // fixed sampleRate, etc.) must still release micStream and report health —
  // otherwise the mic keeps running with no server-side visibility at all.
  // audioCtx/source/detector are declared outside the try so a failure that
  // happens before one of them is created still lets teardown() no-op safely
  // on the ones that never got made.
  let audioCtx: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let detector: WakeWordDetector | undefined;

  async function teardown(): Promise<void> {
    source?.disconnect();
    for (const track of micStream.getTracks()) track.stop();
    if (audioCtx) await audioCtx.close();
    if (detector) await detector.dispose();
  }

  try {
    const [{ createUtteranceCapture }, { createWakeWordDetector }, { startVoiceAssistant }] = await Promise.all([
      import('./capture'),
      import('./wakeword'),
      import('./index'),
    ]);

    audioCtx = new AudioContext({ sampleRate: 16000 });
    source = audioCtx.createMediaStreamSource(micStream);

    const capture = createUtteranceCapture({
      onChunk: (seq, chunk, final) => connection.sendVoiceAudio(seq, chunk, final),
    });

    detector = createWakeWordDetector({
      // Wake arms capture so the *following* frames get buffered — frames
      // before this point (including the wake phrase itself) are never
      // captured. See capture.ts's armed/idle gate.
      onWake: () => {
        capture.arm();
        onOverlayState('listening');
      },
    });

    try {
      await detector.load();
    } catch {
      connection.sendVoiceHealth('model_load_failed');
      await teardown();
      return null;
    }

    // ScriptProcessorNode is deprecated in favor of AudioWorklet, but it's
    // universally supported and adequate for this frame rate — not worth the
    // extra worklet-module-loading complexity for this task.
    const processor = audioCtx.createScriptProcessor(1280, 1, 1);
    const activeDetector = detector;
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      // Guards against a mismatched ONNX tensor-name assumption (see
      // wakeword.ts) throwing on every single frame (~12.5x/sec) and
      // spamming an unhandled-rejection storm.
      void activeDetector.processFrame(input).catch(() => {});
      // Wake detection always runs on every frame (above). Capture, however,
      // only buffers/forwards frames while armed — pushFrame is a no-op
      // until onWake calls capture.arm(), so pre-wake audio (including loud
      // speech that never triggers the wake word) is never sent to HA.
      capture.pushFrame(floatTo16BitPCM(input));
    };
    source.connect(processor);
    processor.connect(audioCtx.destination);

    connection.sendVoiceHealth('ok');

    let forward: ((msg: ServerMessage) => void) | null = null;
    const assistant = startVoiceAssistant(connection, onOverlayState, {
      onServerMessage: (fn) => {
        forward = fn;
      },
    });

    return {
      handleServerMessage(msg) {
        forward?.(msg);
      },
      async stop() {
        processor.disconnect();
        assistant.stop();
        await teardown();
      },
    };
  } catch {
    connection.sendVoiceHealth('model_load_failed');
    await teardown();
    return null;
  }
}
