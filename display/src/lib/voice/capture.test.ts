import { describe, it, expect, vi } from 'vitest';
import { createUtteranceCapture } from './capture';

function silentFrame(n = 320): Int16Array {
  return new Int16Array(n); // all zeros -> RMS 0, below any threshold
}

function loudFrame(n = 320): Int16Array {
  const f = new Int16Array(n);
  f.fill(10000);
  return f;
}

describe('createUtteranceCapture', () => {
  it('buffers frames and does not emit until silence timeout after speech', () => {
    vi.useFakeTimers();
    const onChunk = vi.fn();
    const capture = createUtteranceCapture({ onChunk, silenceMs: 500, maxMs: 5000 });
    capture.pushFrame(loudFrame());
    expect(onChunk).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    capture.pushFrame(silentFrame());
    vi.advanceTimersByTime(600);
    expect(onChunk).toHaveBeenCalled();
    const lastCall = onChunk.mock.calls[onChunk.mock.calls.length - 1];
    expect(lastCall[2]).toBe(true); // final chunk
    vi.useRealTimers();
  });

  it('force-ends at maxMs even with continuous speech', () => {
    vi.useFakeTimers();
    const onChunk = vi.fn();
    const capture = createUtteranceCapture({ onChunk, silenceMs: 500, maxMs: 1000 });
    capture.pushFrame(loudFrame());
    vi.advanceTimersByTime(1100);
    capture.pushFrame(loudFrame());
    expect(onChunk).toHaveBeenCalled();
    const lastCall = onChunk.mock.calls[onChunk.mock.calls.length - 1];
    expect(lastCall[2]).toBe(true);
    vi.useRealTimers();
  });
});
