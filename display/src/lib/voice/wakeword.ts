import { InferenceSession, Tensor } from 'onnxruntime-web';

export type WakeWordDetectorOpts = {
  onWake: () => void;
  modelUrl?: string;
  threshold?: number;
};

export type WakeWordDetector = {
  load(): Promise<void>;
  processFrame(frame: Float32Array): Promise<void>;
  dispose(): Promise<void>;
};

/**
 * Loads an openWakeWord ONNX model and scores incoming PCM frames against it,
 * firing `onWake` whenever the inference score crosses `threshold`.
 *
 * The `.onnx` model binary is a build asset (like the mood `.mp4` clips), not
 * source code — it must be placed at `modelUrl` (default `/voice/wakeword.onnx`)
 * separately from this module.
 */
export function createWakeWordDetector(opts: WakeWordDetectorOpts): WakeWordDetector {
  const modelUrl = opts.modelUrl ?? '/voice/wakeword.onnx';
  const threshold = opts.threshold ?? 0.5;
  let session: InferenceSession | null = null;

  return {
    async load() {
      session = await InferenceSession.create(modelUrl);
    },
    async processFrame(frame: Float32Array) {
      if (!session) return;
      const tensor = new Tensor('float32', frame, [1, frame.length]);
      // ASSUMPTION: 'input'/'output' are placeholder tensor names for a
      // single-stage PCM-in/score-out model. The real exported openWakeWord
      // `.onnx` asset (wired in separately, not part of this task) may use
      // different names — whoever adds that asset must verify these against
      // the model's actual `session.inputNames`/`session.outputNames` (both
      // available on the real onnxruntime-web API) and adjust if they differ.
      const results = await session.run({ input: tensor } as unknown as Record<string, Tensor>);
      const score = (results.output.data as Float32Array)[0];
      if (score >= threshold) opts.onWake();
    },
    async dispose() {
      if (session) {
        await session.release();
        session = null;
      }
    },
  };
}
