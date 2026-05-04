import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { DisplaysRepo } from '../store/displays.js';
import type { ScenesRepo } from '../store/scenes.js';
import { buildSceneState } from '../scenes/assembler.js';

export type WsDeps = {
  displays: DisplaysRepo;
  scenes: ScenesRepo;
};

export type CosmosWss = WebSocketServer & {
  pushSceneTo(displayId: string): void;
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

function activeSceneId(displayId: string, deps: WsDeps): string | null {
  const d = deps.displays.getById(displayId);
  if (!d) return null;
  return d.currentSceneId ?? d.defaultSceneId ?? null;
}

function sceneMessageFor(displayId: string, deps: WsDeps): string | null {
  const sceneId = activeSceneId(displayId, deps);
  if (!sceneId) return null;
  const scene = deps.scenes.get(sceneId);
  if (!scene) return null;
  return JSON.stringify({ type: 'scene', state: buildSceneState(scene) });
}

export function attachWsHub(server: Server, deps: WsDeps): CosmosWss {
  const wss = new WebSocketServer({ server, path: '/ws' }) as CosmosWss;
  const sockets = new Map<string, Set<WebSocket>>();

  wss.on('connection', (socket: WebSocket) => {
    let ownDisplayId: string | null = null;
    socket.on('close', () => {
      if (ownDisplayId) {
        sockets.get(ownDisplayId)?.delete(socket);
      }
    });
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
      ownDisplayId = display.id;
      const set = sockets.get(display.id) ?? new Set<WebSocket>();
      set.add(socket);
      sockets.set(display.id, set);

      socket.send(
        JSON.stringify({
          type: 'welcome',
          displayId: display.id,
          message: `Hello, ${display.name}!`,
        })
      );

      const sceneMsg = sceneMessageFor(display.id, deps);
      if (sceneMsg) socket.send(sceneMsg);
    });
  });

  wss.pushSceneTo = (displayId: string) => {
    const set = sockets.get(displayId);
    if (!set || set.size === 0) return;
    const sceneMsg = sceneMessageFor(displayId, deps);
    if (!sceneMsg) return;
    for (const s of set) {
      if (s.readyState === s.OPEN) s.send(sceneMsg);
    }
  };

  return wss;
}
