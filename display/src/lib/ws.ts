export type WelcomeMessage = { type: 'welcome'; displayId: string; message: string };
export type ServerMessage = WelcomeMessage | { type: 'error'; error: string };

export function connect(displayName: string, onMessage: (msg: ServerMessage) => void): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/ws`;
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'hello', displayName }));
  });
  ws.addEventListener('message', (event) => {
    try {
      const parsed = JSON.parse(event.data) as ServerMessage;
      onMessage(parsed);
    } catch {
      onMessage({ type: 'error', error: 'invalid server message' });
    }
  });
  ws.addEventListener('error', () => {
    onMessage({ type: 'error', error: 'websocket error' });
  });
  ws.addEventListener('close', (event) => {
    if (!event.wasClean) {
      onMessage({ type: 'error', error: 'connection lost' });
    }
  });
  return ws;
}
