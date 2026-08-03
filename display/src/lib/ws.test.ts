import { describe, it, expect, beforeEach } from 'vitest';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { wasClean: boolean }) => void) | null = null;
  sent: string[] = [];
  sentBinary: unknown[] = [];
  constructor() {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(evt: string, cb: (e?: unknown) => void) {
    if (evt === 'open') this.onopen = cb as () => void;
    if (evt === 'message') this.onmessage = cb as (e: { data: string }) => void;
    if (evt === 'error') this.onerror = cb as () => void;
    if (evt === 'close') this.onclose = cb as (e: { wasClean: boolean }) => void;
  }
  send(data: string | ArrayBuffer) {
    if (typeof data === 'string') this.sent.push(data);
    else this.sentBinary.push(data);
  }
  close() {}
}

describe('voice WS extensions', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    // jsdom already provides a real `window`/`window.location` (default
    // http://localhost:3000/), which is all ws.ts needs to build its URL —
    // no need to stub `window` itself as the brief's original scaffolding
    // did (that fights jsdom's non-configurable global and throws).
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  });

  it('sendVoiceAudio sends a base64-encoded voice_audio frame', async () => {
    const { connect } = await import('./ws');
    const conn = connect('kitchen', () => {});
    const sock = FakeWebSocket.instances[0];
    sock.onopen?.();
    conn.sendVoiceAudio(0, new Uint8Array([1, 2, 3]), true);
    const frame = JSON.parse(sock.sent[sock.sent.length - 1]);
    expect(frame.type).toBe('voice_audio');
    expect(frame.seq).toBe(0);
    expect(frame.final).toBe(true);
    expect(typeof frame.chunk).toBe('string');
    conn.close();
  });

  it('sendVoiceHealth sends a voice_health frame', async () => {
    const { connect } = await import('./ws');
    const conn = connect('kitchen', () => {});
    const sock = FakeWebSocket.instances[0];
    sock.onopen?.();
    conn.sendVoiceHealth('permission_denied');
    const frame = JSON.parse(sock.sent[sock.sent.length - 1]);
    expect(frame).toEqual({ type: 'voice_health', mic: 'permission_denied' });
    conn.close();
  });

  it('dispatches a voice_result message to onMessage', async () => {
    const { connect } = await import('./ws');
    const received: unknown[] = [];
    const conn = connect('kitchen', (msg) => received.push(msg));
    const sock = FakeWebSocket.instances[0];
    sock.onopen?.();
    sock.onmessage?.({ data: JSON.stringify({ type: 'voice_result', stage: 'stt-end', text: 'hi' }) });
    expect(received).toContainEqual({ type: 'voice_result', stage: 'stt-end', text: 'hi' });
    conn.close();
  });
});
