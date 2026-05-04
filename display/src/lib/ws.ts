import type { SceneState, OverlayMessage } from './types';
import type { TransitionDescriptor } from './transitions/types';

export type WelcomeMessage = { type: 'welcome'; displayId: string; message: string };
export type SceneMessage = { type: 'scene'; state: SceneState; transition?: TransitionDescriptor };
export type OverlayPushMessage = { type: 'overlay'; overlay: OverlayMessage };
export type OverlayDismissMessage = { type: 'overlay_dismiss' };
export type ErrorMessage = { type: 'error'; error: string };
export type ServerMessage =
  | WelcomeMessage
  | SceneMessage
  | OverlayPushMessage
  | OverlayDismissMessage
  | ErrorMessage;

export type CosmosConnection = {
  close(): void;
};

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export function connect(displayName: string, onMessage: (msg: ServerMessage) => void): CosmosConnection {
  let socket: WebSocket | null = null;
  let backoff = INITIAL_BACKOFF_MS;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function open() {
    if (closed) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      backoff = INITIAL_BACKOFF_MS;
      socket?.send(JSON.stringify({ type: 'hello', displayName }));
    });
    socket.addEventListener('message', (event) => {
      try {
        onMessage(JSON.parse(event.data) as ServerMessage);
      } catch {
        onMessage({ type: 'error', error: 'invalid server message' });
      }
    });
    socket.addEventListener('error', () => {
      onMessage({ type: 'error', error: 'websocket error' });
    });
    socket.addEventListener('close', (event) => {
      socket = null;
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
      socket?.close();
    },
  };
}
