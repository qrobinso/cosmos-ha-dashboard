import { describe, it, expect, vi } from 'vitest';

const fakeSession = {
  run: vi.fn(async () => ({ output: { data: new Float32Array([0.9]) } })),
};

vi.mock('onnxruntime-web', () => ({
  InferenceSession: { create: vi.fn(async () => fakeSession) },
  Tensor: class {
    constructor(public type: string, public data: Float32Array, public dims: number[]) {}
  },
}));

describe('createWakeWordDetector', () => {
  it('fires onWake when inference score exceeds the threshold', async () => {
    const { createWakeWordDetector } = await import('./wakeword.js');
    const onWake = vi.fn();
    const detector = createWakeWordDetector({ onWake, modelUrl: '/voice/wakeword.onnx', threshold: 0.5 });
    await detector.load();
    await detector.processFrame(new Float32Array(1280));
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('does not fire when inference score is below the threshold', async () => {
    fakeSession.run.mockResolvedValueOnce({ output: { data: new Float32Array([0.1]) } });
    const { createWakeWordDetector } = await import('./wakeword.js');
    const onWake = vi.fn();
    const detector = createWakeWordDetector({ onWake, modelUrl: '/voice/wakeword.onnx', threshold: 0.5 });
    await detector.load();
    await detector.processFrame(new Float32Array(1280));
    expect(onWake).not.toHaveBeenCalled();
  });
});
