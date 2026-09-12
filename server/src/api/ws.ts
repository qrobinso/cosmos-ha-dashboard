import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { DisplaysRepo } from '../store/displays.js';
import type { ScenesRepo } from '../store/scenes.js';
import type { SettingsRepo } from '../store/settings.js';
import type { TransitionsRepo, OverridesRepo } from '../store/transitions.js';
import { assemblePush, absolutizeMediaUrl } from '../scenes/assembler.js';
import { readSafeArea, readTransitionSpeed } from './http.js';
import { readCanvasFetchPolicy } from '../store/canvasFetch.js';
import type { OverlayMessage } from '../overlay/types.js';
import type { VoiceRelay } from '../voice/relay.js';
import type { VoiceResult, VoiceHealth } from '../voice/types.js';

export type PushReason =
  | 'hello'
  | 'scene-change'
  | 'reactive'
  | 'rotation'
  | 'settings'
  | 'alert'
  | 'palette'
  | 'canvas-extras'
  | 'unknown';

// Read once at module load: gating each push on a fresh process.env lookup
// would be wasted work in the hot path.
const LOG_PUSHES = process.env.LOG_PUSHES === '1';

export type WsDeps = {
  displays: DisplaysRepo;
  scenes: ScenesRepo;
  settings: SettingsRepo;
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
  resolveEntity?: import('../scenes/assembler.js').EntityResolver;
  resolveCalendarEvents?: import('../scenes/assembler.js').DataResolvers['resolveCalendarEvents'];
  resolveHistory?: import('../scenes/assembler.js').DataResolvers['resolveHistory'];
  resolveWeatherForecasts?: import('../scenes/assembler.js').DataResolvers['resolveWeatherForecasts'];
  resolveCameraCapabilities?: import('../scenes/assembler.js').DataResolvers['resolveCameraCapabilities'];
  readEntitySync?: import('../scenes/assembler.js').DataResolvers['readEntitySync'];
  aerialAssets?: import('../scenes/assembler.js').DataResolvers['aerialAssets'];
  /** HA base URL — used to absolutize relative media-player art paths. */
  mediaUrlBase?: string;
  onDisplayOnline?: (displayId: string, name: string) => void;
  onDisplayOffline?: (displayId: string, name: string) => void;
  /** Called after `displays.registerByName` succeeds during the WS hello.
   *  Used by the host to refresh its HA interest-set so a new display's
   *  active scene immediately starts driving entity-tick reactivity. */
  onDisplayRegistered?: (displayId: string, name: string) => void;
  onSceneActivated?: (displayId: string, sceneName: string | null) => void;
  canvasResolver?: import('../scenes/assembler.js').DataResolvers['canvasResolver'];
  musicVideoResolver?: import('../scenes/assembler.js').DataResolvers['musicVideoResolver'];
  canvasExtras?: import('../scenes/assembler.js').DataResolvers['canvasExtras'];
  canvasExtrasOnDisconnect?: (displayName: string) => void;
  /** Called from buildPayload before sending so iframe-side subscriptions
   *  for canvases NOT on the new scene get released. Without this, switching
   *  away from a canvas scene leaves the old subscriptions queuing scene
   *  re-pushes for entity changes nothing on the current scene cares about. */
  canvasExtrasPruneForDisplay?: (displayName: string, keepWidgetIds: Iterable<string>) => void;
  /** When set, `buildPayload` reads the resolved palette here and passes
   *  it into the assembler so adaptive_colors can override gradient.colors.
   *  Also pruned on scene change and cleared on display disconnect. */
  displayPalette?: import('../store/displayPalette.js').DisplayPaletteStore;
  /** Relay to HA's Assist pipeline. Undefined when voice/HA is unavailable —
   *  inbound voice_audio frames are then silently ignored (no-op, not an error). */
  voiceRelay?: VoiceRelay;
};

export type CosmosWss = WebSocketServer & {
  pushSceneTo(
    displayId: string,
    opts?: { explicitTransitionId?: string | null; reason?: PushReason }
  ): Promise<void>;
  pushSettingsChanged(): Promise<void>;
  pushOverlayTo(displayId: string, overlay: OverlayMessage): void;
  pushOverlayToAll(overlay: OverlayMessage): void;
  dismissOverlayFor(displayId: string): void;
  dismissOverlayForAll(): void;
  pushDisplayConfigTo(displayId: string): void;
  pushVoiceResultTo(displayId: string, result: VoiceResult): void;
  getVoiceHealth(displayId: string): VoiceHealth | null;
};

type ClientMessage =
  | { type: 'hello'; displayName: string }
  | { type: 'voice_audio'; seq: number; chunk: string; final: boolean }
  | { type: 'voice_health'; mic: VoiceHealth };

function isHello(value: unknown): value is Extract<ClientMessage, { type: 'hello' }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'hello' &&
    typeof (value as { displayName?: unknown }).displayName === 'string'
  );
}

function isVoiceAudio(value: unknown): value is Extract<ClientMessage, { type: 'voice_audio' }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'voice_audio' &&
    typeof (value as { chunk?: unknown }).chunk === 'string' &&
    typeof (value as { final?: unknown }).final === 'boolean'
  );
}

function isVoiceHealth(value: unknown): value is Extract<ClientMessage, { type: 'voice_health' }> {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'voice_health';
}

function activeSceneId(displayId: string, deps: WsDeps): string | null {
  const d = deps.displays.getById(displayId);
  if (!d) return null;
  return d.currentSceneId ?? d.defaultSceneId ?? null;
}

// App-level heartbeat: send a small JSON ping every 25s so clients have a
// steady inbound signal (their liveness timer will trip on long silence) and
// to keep NAT mappings warm. Browser WS API doesn't expose protocol pings.
const PING_INTERVAL_MS = 25_000;

export function attachWsHub(server: Server, deps: WsDeps): CosmosWss {
  const wss = new WebSocketServer({ server, path: '/ws' }) as CosmosWss;
  const sockets = new Map<string, Set<WebSocket>>();
  const lastSceneByDisplay = new Map<string, string>();
  // Per-connection buffer of decoded audio chunks for the utterance currently
  // in flight on that socket. Keyed by socket (not displayId) so multiple
  // sockets for the same display never share a buffer. Drained and deleted
  // as soon as a `final:true` frame arrives, so a second utterance on the
  // same socket always starts from a fresh empty buffer — no cross-utterance
  // mixing even if frames for utterance N+1 arrive before N's relay finishes.
  // `overflowed` marks a buffer that has already blown past the cap below —
  // once set it stays true (chunks stop being retained) until the next
  // `final:true` frame starts a fresh utterance from a clean slate.
  const voiceAudioBuffers = new Map<WebSocket, { chunks: Buffer[]; bytes: number; overflowed: boolean }>();
  const lastVoiceHealthByDisplay = new Map<string, VoiceHealth>();
  // ~60s of 16kHz 16-bit mono PCM (16000 samples/s * 2 bytes/sample * 60s ≈
  // 1.9MB); round up to 2MB. Caps a single socket's runaway/malicious
  // buffering — a client that never sends `final:true` would otherwise grow
  // this Buffer[] unbounded for as long as the connection stays open.
  const MAX_VOICE_AUDIO_BYTES = 2 * 1024 * 1024;

  const pingMsg = JSON.stringify({ type: 'ping' });
  const heartbeat = setInterval(() => {
    for (const set of sockets.values()) {
      for (const s of set) {
        if (s.readyState === s.OPEN) {
          try { s.send(pingMsg); } catch { /* socket dying — close handler will clean up */ }
        }
      }
    }
  }, PING_INTERVAL_MS);
  wss.on('close', () => clearInterval(heartbeat));

  async function buildPayload(
    displayId: string,
    explicitTransitionId?: string | null
  ): Promise<{ payload: string; assembleMs: number; widgets: number; sceneName: string; transitionId: string | null } | null> {
    const sceneId = activeSceneId(displayId, deps);
    if (!sceneId) return null;
    const scene = deps.scenes.get(sceneId);
    if (!scene) return null;
    const previousSceneId = lastSceneByDisplay.get(displayId) ?? null;
    const safeArea = readSafeArea(deps.settings);
    const transitionSpeedMultiplier = readTransitionSpeed(deps.settings);
    const canvasFetchPolicy = readCanvasFetchPolicy(deps.settings);
    // Prune palette contributions BEFORE reading. Without this, the very
    // first push after a scene change carries the previous scene's widget
    // contributions (the assembler then overrides gradient.colors with
    // colors derived from widgets that aren't even on the new scene).
    if (deps.displayPalette) {
      const keep = new Set(scene.widgets.map((w) => w.id));
      deps.displayPalette.pruneWidgets(displayId, keep);
    }
    const adaptiveContributions = deps.displayPalette?.getContributions(displayId);
    const t0 = performance.now();
    const payload = await assemblePush({
      scene,
      safeArea,
      previousSceneId,
      transitions: deps.transitions,
      overrides: deps.overrides,
      explicitTransitionId,
      transitionSpeedMultiplier,
      canvasFetchPolicy,
      adaptiveContributions,
      resolver: deps.resolveEntity,
      resolveCalendarEvents: deps.resolveCalendarEvents,
      resolveHistory: deps.resolveHistory,
      resolveWeatherForecasts: deps.resolveWeatherForecasts,
      resolveCameraCapabilities: deps.resolveCameraCapabilities,
      readEntitySync: deps.readEntitySync,
      aerialAssets: deps.aerialAssets,
      mediaUrlBase: deps.mediaUrlBase,
      canvasResolver: deps.canvasResolver,
      canvasExtras: deps.canvasExtras,
      musicVideoResolver: deps.musicVideoResolver,
    });
    const assembleMs = performance.now() - t0;
    lastSceneByDisplay.set(displayId, scene.id);

    // Prune iframe-side subscriptions for canvases not on this scene.
    // Without this the extras union grows monotonically across scene
    // switches, forcing redundant scene re-pushes on entity changes that
    // nothing on the current scene actually renders.
    if (deps.canvasExtrasPruneForDisplay) {
      const display = deps.displays.getById(displayId);
      if (display) {
        const canvasIdsOnScene = new Set<string>();
        for (const w of scene.widgets) if (w.kind === 'canvas') canvasIdsOnScene.add(w.id);
        deps.canvasExtrasPruneForDisplay(display.name, canvasIdsOnScene);
      }
    }

    deps.onSceneActivated?.(displayId, scene.name);
    const transitionId = (payload as { transition?: { id?: string } }).transition?.id ?? null;
    const json = JSON.stringify(payload);
    return { payload: json, assembleMs, widgets: scene.widgets.length, sceneName: scene.name, transitionId };
  }

  wss.on('connection', (socket: WebSocket) => {
    let ownDisplayId: string | null = null;
    socket.on('close', () => {
      // Drop any in-progress voice-audio buffer for this socket. Without
      // this, a disconnect mid-utterance leaks the accumulated Buffer[]
      // forever since nothing else ever reaches `final:true` for it.
      voiceAudioBuffers.delete(socket);
      if (!ownDisplayId) return;
      const set = sockets.get(ownDisplayId);
      set?.delete(socket);
      if (set && set.size === 0) {
        sockets.delete(ownDisplayId);
        lastSceneByDisplay.delete(ownDisplayId);
        const d = deps.displays.getById(ownDisplayId);
        if (d) {
          deps.onDisplayOffline?.(ownDisplayId, d.name);
          deps.canvasExtrasOnDisconnect?.(d.name);
          deps.displayPalette?.clearDisplay(ownDisplayId);
        }
      }
    });
    socket.on('message', (raw) => {
      void (async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          socket.send(JSON.stringify({ type: 'error', error: 'invalid json' }));
          return;
        }
        if (isVoiceAudio(parsed)) {
          if (!deps.voiceRelay || !ownDisplayId) return;
          const displayId = ownDisplayId;
          let entry = voiceAudioBuffers.get(socket);
          if (!entry) {
            entry = { chunks: [], bytes: 0, overflowed: false };
            voiceAudioBuffers.set(socket, entry);
          }
          if (!entry.overflowed) {
            const chunk = Buffer.from(parsed.chunk, 'base64');
            entry.chunks.push(chunk);
            entry.bytes += chunk.length;
            if (entry.bytes > MAX_VOICE_AUDIO_BYTES) {
              // Drop what's buffered so far and stop retaining further
              // chunks; the `final:true` branch below still fires (so the
              // socket doesn't wedge) but relays nothing for this utterance.
              entry.overflowed = true;
              entry.chunks = [];
            }
          }
          if (parsed.final) {
            voiceAudioBuffers.delete(socket);
            if (entry.overflowed) return;
            const chunks = entry.chunks;
            const display = deps.displays.getById(displayId);
            const pipelineId = display?.voicePipelineId ?? null;
            async function* toAsyncIter() {
              for (const c of chunks) yield new Uint8Array(c);
            }
            void deps.voiceRelay.runUtterance(pipelineId, toAsyncIter(), (result) => {
              wss.pushVoiceResultTo(displayId, result);
            });
          }
          return;
        }
        if (isVoiceHealth(parsed)) {
          if (ownDisplayId) lastVoiceHealthByDisplay.set(ownDisplayId, parsed.mic);
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
        deps.onDisplayRegistered?.(display.id, display.name);
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

        // Send the display's current config (orientation, voice, etc.) right after welcome.
        socket.send(
          JSON.stringify({
            type: 'display_config',
            config: {
              orientation: display.orientation,
              voiceEnabled: display.voiceEnabled,
              voicePipelineId: display.voicePipelineId,
            },
          })
        );

        // Hello-time push has no previous scene by definition, so no transition.
        lastSceneByDisplay.delete(display.id);
        deps.onDisplayOnline?.(display.id, display.name);
        const built = await buildPayload(display.id);
        if (built) {
          socket.send(built.payload);
          if (LOG_PUSHES) {
            const set = sockets.get(display.id);
            const bytesKB = Math.round(built.payload.length / 1024);
            console.log(
              `[push] display=${display.name} scene=${built.sceneName} reason=hello transition=${built.transitionId ?? 'none'} assembleMs=${Math.round(built.assembleMs)} widgets=${built.widgets} bytesKB=${bytesKB} sockets=${set?.size ?? 0}`
            );
          }
        }
      })();
    });
  });

  wss.pushSceneTo = async (displayId, opts) => {
    const set = sockets.get(displayId);
    if (!set || set.size === 0) return;
    const built = await buildPayload(displayId, opts?.explicitTransitionId);
    if (!built) return;
    let sent = 0;
    for (const s of set) {
      if (s.readyState === s.OPEN) {
        s.send(built.payload);
        sent++;
      }
    }
    if (LOG_PUSHES) {
      const display = deps.displays.getById(displayId);
      const reason: PushReason = opts?.reason ?? 'unknown';
      const bytesKB = Math.round(built.payload.length / 1024);
      console.log(
        `[push] display=${display?.name ?? displayId} scene=${built.sceneName} reason=${reason} transition=${built.transitionId ?? 'none'} assembleMs=${Math.round(built.assembleMs)} widgets=${built.widgets} bytesKB=${bytesKB} sockets=${sent}`
      );
    }
  };

  wss.pushSettingsChanged = async () => {
    for (const displayId of sockets.keys()) await wss.pushSceneTo(displayId, { reason: 'settings' });
  };

  function sendToDisplay(displayId: string, payload: object): void {
    const set = sockets.get(displayId);
    if (!set || set.size === 0) return;
    const msg = JSON.stringify(payload);
    for (const s of set) {
      if (s.readyState === s.OPEN) s.send(msg);
    }
  }

  wss.pushOverlayTo = (displayId, overlay) => {
    sendToDisplay(displayId, { type: 'overlay', overlay });
  };
  wss.pushOverlayToAll = (overlay) => {
    for (const id of sockets.keys()) sendToDisplay(id, { type: 'overlay', overlay });
  };
  wss.dismissOverlayFor = (displayId) => {
    sendToDisplay(displayId, { type: 'overlay_dismiss' });
  };
  wss.dismissOverlayForAll = () => {
    for (const id of sockets.keys()) sendToDisplay(id, { type: 'overlay_dismiss' });
  };

  wss.pushVoiceResultTo = (displayId, result) => {
    const set = sockets.get(displayId);
    if (!set) return;
    // HA's tts-end audioUrl is HA-relative (e.g. /api/tts_proxy/...). Route
    // it through the same media-proxy convention as entity_picture/camera
    // URLs (see absolutizeMediaUrl) — otherwise `new Audio(url)` on the
    // kiosk resolves it against Cosmos's own origin and 404s.
    const outgoing: VoiceResult = result.audioUrl
      ? { ...result, audioUrl: absolutizeMediaUrl(result.audioUrl, deps.mediaUrlBase) }
      : result;
    const msg = JSON.stringify({ type: 'voice_result', ...outgoing });
    for (const s of set) {
      if (s.readyState === s.OPEN) {
        try {
          s.send(msg);
        } catch {
          /* socket dying — close handler cleans up */
        }
      }
    }
  };

  wss.getVoiceHealth = (displayId) => lastVoiceHealthByDisplay.get(displayId) ?? null;

  wss.pushDisplayConfigTo = (displayId) => {
    const display = deps.displays.getById(displayId);
    if (!display) return;
    sendToDisplay(displayId, {
      type: 'display_config',
      config: {
        orientation: display.orientation,
        voiceEnabled: display.voiceEnabled,
        voicePipelineId: display.voicePipelineId,
      },
    });
  };

  return wss;
}
