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
  pushFrame(frame: Int16Array, rmsThreshold?: number): void;
  reset(): void;
};

function rms(frame: Int16Array): number {
  let sum = 0;
  for (const s of frame) sum += s * s;
  return Math.sqrt(sum / frame.length);
}

/** Copies a frame's samples into a standalone Uint8Array (not a view) so buffered
 *  frames stay valid even if the caller reuses the source buffer for later frames. */
function toBytes(frame: Int16Array): Uint8Array {
  return new Uint8Array(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Buffers mic PCM frames for the duration of one utterance and emits a single
 * final chunk once the utterance ends — either via a silence timeout that starts
 * once speech has begun, or a hard maxMs cap from the start of speech.
 *
 * Leading silence (before any speech is detected) is dropped, not buffered.
 */
export function createUtteranceCapture(opts: UtteranceCaptureOpts): UtteranceCapture {
  const defaultThreshold = opts.rmsThreshold ?? 500;
  const silenceMs = opts.silenceMs ?? 800;
  const maxMs = opts.maxMs ?? 5000;

  let seq = 0;
  let speaking = false;
  let buffered: Uint8Array[] = [];
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
  }

  function finish() {
    if (!speaking) return;
    speaking = false;
    clearTimers();
    const chunk = concatBytes(buffered);
    buffered = [];
    opts.onChunk(seq++, chunk, true);
  }

  return {
    pushFrame(frame: Int16Array, rmsThreshold?: number) {
      const threshold = rmsThreshold ?? defaultThreshold;
      const isSpeech = rms(frame) >= threshold;

      if (!speaking && !isSpeech) {
        // Silence before any speech has started — nothing to buffer yet.
        return;
      }

      if (!speaking && isSpeech) {
        speaking = true;
        buffered = [];
        maxTimer = setTimeout(finish, maxMs);
      }

      buffered.push(toBytes(frame));

      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      if (!isSpeech) {
        silenceTimer = setTimeout(finish, silenceMs);
      }
    },
    reset() {
      speaking = false;
      buffered = [];
      clearTimers();
    },
  };
}
