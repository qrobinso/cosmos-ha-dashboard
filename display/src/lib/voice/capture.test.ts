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
  it('ignores frames before arm() is called, even loud ones', () => {
    vi.useFakeTimers();
    const onChunk = vi.fn();
    const capture = createUtteranceCapture({ onChunk, silenceMs: 500, maxMs: 5000 });
    capture.pushFrame(loudFrame());
    capture.pushFrame(loudFrame());
    vi.advanceTimersByTime(2000);
    capture.pushFrame(silentFrame());
    vi.advanceTimersByTime(2000);
    expect(onChunk).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('buffers frames and does not emit until silence timeout after speech, once armed', () => {
    vi.useFakeTimers();
    const onChunk = vi.fn();
    const capture = createUtteranceCapture({ onChunk, silenceMs: 500, maxMs: 5000 });
    capture.arm();
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

  it('force-ends at maxMs even with continuous speech, once armed', () => {
    vi.useFakeTimers();
    const onChunk = vi.fn();
    const capture = createUtteranceCapture({ onChunk, silenceMs: 500, maxMs: 1000 });
    capture.arm();
    capture.pushFrame(loudFrame());
    vi.advanceTimersByTime(1100);
    capture.pushFrame(loudFrame());
    expect(onChunk).toHaveBeenCalled();
    const lastCall = onChunk.mock.calls[onChunk.mock.calls.length - 1];
    expect(lastCall[2]).toBe(true);
    vi.useRealTimers();
  });

  it('disarms after armTimeoutMs with no speech and emits nothing', () => {
    vi.useFakeTimers();
    const onChunk = vi.fn();
    const capture = createUtteranceCapture({ onChunk, silenceMs: 500, maxMs: 5000, armTimeoutMs: 4000 });
    capture.arm();
    // Only silence arrives during the arm window — nothing should start
    // buffering, and the arm window itself should close on schedule.
    capture.pushFrame(silentFrame());
    vi.advanceTimersByTime(4000);
    expect(onChunk).not.toHaveBeenCalled();
    // Now disarmed: even loud frames after the timeout must be ignored.
    capture.pushFrame(loudFrame());
    vi.advanceTimersByTime(2000);
    expect(onChunk).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('disarms itself once an utterance finishes, ignoring frames until the next arm()', () => {
    vi.useFakeTimers();
    const onChunk = vi.fn();
    const capture = createUtteranceCapture({ onChunk, silenceMs: 500, maxMs: 5000 });
    capture.arm();
    capture.pushFrame(loudFrame());
    capture.pushFrame(silentFrame());
    vi.advanceTimersByTime(600);
    expect(onChunk).toHaveBeenCalledTimes(1);

    // Post-utterance frames are ignored until the next arm().
    capture.pushFrame(loudFrame());
    vi.advanceTimersByTime(2000);
    expect(onChunk).toHaveBeenCalledTimes(1);

    // A fresh arm() + speech captures a second utterance.
    capture.arm();
    capture.pushFrame(loudFrame());
    capture.pushFrame(silentFrame());
    vi.advanceTimersByTime(600);
    expect(onChunk).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
