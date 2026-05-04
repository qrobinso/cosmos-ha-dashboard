import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { DisplaysRepo } from '../store/displays.js';

export type WsDeps = {
  displays: DisplaysRepo;
};

type ClientMessage = { type: 'hello'; displayName: string };

function isHello(value: unknown): value is ClientMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'hello' &&
    typeof (value as { displayName?: unknown }).displayName === 'string'
  );
}

export function attachWsHub(server: Server, deps: WsDeps): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'invalid json' }));
        return;
      }
      if (!isHello(parsed)) {
        socket.send(JSON.stringify({ type: 'error', error: 'unsupported message' }));
        return;
      }
      const name = parsed.displayName.trim();
      if (!name) {
        socket.send(JSON.stringify({ type: 'error', error: 'displayName required' }));
        return;
      }
      const display = deps.displays.registerByName(name);
      deps.displays.touch(display.id);
      socket.send(
        JSON.stringify({
          type: 'welcome',
          displayId: display.id,
          message: `Hello, ${display.name}!`,
        })
      );
    });
  });

  return wss;
}
