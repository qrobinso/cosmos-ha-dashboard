import type { SceneState, OverlayMessage } from './types';
import type { TransitionDescriptor } from './transitions/types';

export type Orientation = 'landscape' | 'portrait';
export type DisplayConfig = {
  orientation: Orientation;
  voiceEnabled: boolean;
  voicePipelineId: string | null;
};

export type WelcomeMessage = { type: 'welcome'; displayId: string; message: string };
export type DisplayConfigMessage = { type: 'display_config'; config: DisplayConfig };
export type SceneMessage = { type: 'scene'; state: SceneState; transition?: TransitionDescriptor };
export type OverlayPushMessage = { type: 'overlay'; overlay: OverlayMessage };
export type OverlayDismissMessage = { type: 'overlay_dismiss' };
export type ErrorMessage = { type: 'error'; error: string };
export type PingMessage = { type: 'ping' };
export type VoiceResultMessage = {
  type: 'voice_result';
  stage: 'listening' | 'stt-end' | 'intent-end' | 'tts-end' | 'error';
  text?: string;
  audioUrl?: string;
  error?: string;
};
export type ServerMessage =
  | WelcomeMessage
  | DisplayConfigMessage
  | SceneMessage
  | OverlayPushMessage
  | OverlayDismissMessage
  | ErrorMessage
  | PingMessage
  | VoiceResultMessage;

export type CosmosConnection = {
  close(): void;
  sendVoiceAudio(seq: number, chunk: Uint8Array, final: boolean): void;
  sendVoiceHealth(mic: 'ok' | 'permission_denied' | 'model_load_failed' | 'idle' | 'error'): void;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
// Server pings every 25s. If we see nothing (no message + no ping) for 60s,
// the link is dead — force-close so the OS doesn't sit in TCP-FIN limbo.
const LIVENESS_TIMEOUT_MS = 60_000;

export function connect(displayName: string, onMessage: (msg: ServerMessage) => void): CosmosConnection {
  let socket: WebSocket | null = null;
  let backoff = INITIAL_BACKOFF_MS;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let livenessTimer: ReturnType<typeof setTimeout> | null = null;

  function bumpLiveness() {
    if (livenessTimer) clearTimeout(livenessTimer);
    livenessTimer = setTimeout(() => {
      // Browsers don't expose ws ping frames; this fires only on long silence.
      socket?.close();
    }, LIVENESS_TIMEOUT_MS);
  }

  function open() {
    if (closed) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      backoff = INITIAL_BACKOFF_MS;
      bumpLiveness();
      socket?.send(JSON.stringify({ type: 'hello', displayName }));
    });
    socket.addEventListener('message', (event) => {
      // Any inbound server message (including app-level pings) resets liveness.
      bumpLiveness();
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.type === 'ping') return; // keepalive only — don't surface
        onMessage(msg);
      } catch {
        onMessage({ type: 'error', error: 'invalid server message' });
      }
    });
    socket.addEventListener('error', () => {
      onMessage({ type: 'error', error: 'websocket error' });
    });
    socket.addEventListener('close', (event) => {
      socket = null;
      if (livenessTimer) { clearTimeout(livenessTimer); livenessTimer = null; }
      if (closed) return;
      if (!event.wasClean) {
        onMessage({ type: 'error', error: 'connection lost — reconnecting' });
      }
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        open();
      }, backoff);
    });
  }

  open();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (livenessTimer) clearTimeout(livenessTimer);
      socket?.close();
    },
    sendVoiceAudio(seq, chunk, final) {
      socket?.send(JSON.stringify({ type: 'voice_audio', seq, chunk: toBase64(chunk), final }));
    },
    sendVoiceHealth(mic) {
      socket?.send(JSON.stringify({ type: 'voice_health', mic }));
    },
  };
}
