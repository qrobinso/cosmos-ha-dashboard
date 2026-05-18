import { config } from './config.js';
import { openDatabase } from './store/db.js';
import { runMigrations } from './store/migrations.js';
import { createDisplaysRepo } from './store/displays.js';
import { createSettingsRepo } from './store/settings.js';
import { createScenesRepo } from './store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from './store/transitions.js';
import { createDesignPacksRepo } from './store/design-packs.js';
import { buildHttpApp, readTransitionSpeed, readSafeArea } from './api/http.js';
import { attachWsHub } from './api/ws.js';
import { registerStatic } from './static.js';
import { makeHaClient } from './ha/client.js';
import type { HaClient } from './ha/types.js';
import { mockEntityResolver, buildSceneState } from './scenes/assembler.js';
import { resolveMoodsDir } from './moods/scan.js';
import { createTemplatesClient } from './ha/templates.js';
import { createCanvasResolver } from './scenes/canvas.js';
import { createAlertManager } from './scenes/alerts.js';
import { createCanvasExtrasStore } from './api/canvases.js';
import { createCalendarCache } from './ha/calendarCache.js';
import { createInterestSet, sceneAmbientEntityIds } from './scenes/interest.js';
import { createDisplayPaletteStore } from './store/displayPalette.js';
import { resolveEffectiveHaConfig } from './store/ha-settings.js';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';

const __cosmos_src_dir = dirname(fileURLToPath(import.meta.url));
const __cosmos_repo_root = resolvePath(__cosmos_src_dir, '..', '..');

function widgetEntityIds(scenes: ReturnType<typeof createScenesRepo>): Set<string> {
  const ids = new Set<string>();
  for (const s of scenes.list()) {
    for (const w of s.widgets) {
      const id = (w.config as { entity_id?: string }).entity_id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

async function main() {
  const db = openDatabase(config.dbPath);
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  const designs = createDesignPacksRepo(db);
  // Resolve the builtins folder relative to this file so the seed works from
  // both dev (tsx running TS source under src/) and prod (compiled JS in dist/).
  designs.seedBuiltinsFromDir(join(__cosmos_src_dir, 'designs', 'builtins'));

  // Resolve effective HA + MQTT settings, falling back to Supervisor when running as an add-on.
  const { fetchMqttFromSupervisor, SUPERVISOR_HA_URL, SUPERVISOR_BASE } = await import('./ha/supervisor.js');
  const effectiveHa = resolveEffectiveHaConfig({
    settings,
    envUrl: config.haUrl,
    envToken: config.haToken,
    supervisorToken: config.supervisorToken,
    supervisorUrl: SUPERVISOR_HA_URL,
  });
  const effectiveHaUrl = effectiveHa.url;
  const effectiveHaToken = effectiveHa.token;
  let effectiveMqttUrl = config.mqttUrl;
  if (!effectiveMqttUrl && config.supervisorToken) {
    const result = await fetchMqttFromSupervisor(SUPERVISOR_BASE, config.supervisorToken);
    if (result) {
      effectiveMqttUrl = result.url;
      console.log(`MQTT broker discovered via Supervisor: ${result.url.replace(/:[^:@/]*@/, ':***@')}`);
    } else {
      console.log('Supervisor reports no MQTT service available');
    }
  }

  let haClient: HaClient | null = null;
  if (effectiveHaUrl && effectiveHaToken) {
    try {
      console.log(`connecting to Home Assistant at ${effectiveHaUrl} (${effectiveHa.source})`);
      haClient = await makeHaClient({ url: effectiveHaUrl, token: effectiveHaToken });
      await haClient.ready();
      console.log('Home Assistant connected; entity cache populated');
    } catch (err) {
      console.error('Home Assistant connection failed; falling back to mock entity data', err);
      haClient = null;
    }
  } else {
    console.log('Home Assistant not configured; using mock entity data');
  }

  const resolveEntity = haClient
    ? (entityId: string) => haClient!.getEntity(entityId) ?? mockEntityResolver(entityId)
    : mockEntityResolver;
  const resolveCalendarEvents = haClient
    ? (entityId: string, opts: { start: Date; end: Date }) => haClient!.getCalendarEvents(entityId, opts)
    : undefined;
  const resolveHistory = haClient
    ? (entityId: string, opts: { start: Date; end: Date }) => haClient!.getHistory(entityId, opts)
    : undefined;
  const resolveWeatherForecasts = haClient
    ? (entityId: string, type: import('./scenes/types.js').WeatherForecastType) =>
        haClient!.getWeatherForecasts(entityId, type)
    : undefined;
  const resolveCameraCapabilities = haClient
    ? (entityId: string) => haClient!.getCameraCapabilities(entityId)
    : undefined;
  const readEntitySync = haClient ? (id: string) => haClient!.getEntity(id) : undefined;

  let wssRef: ReturnType<typeof attachWsHub> | null = null;
  let mqttClient: import('./mqtt/types.js').MqttClient | null = null;

  // Track per-display "previous current scene" so HA automations can flip
  // back to the last-used scene. Updated on every scene change: when the
  // current scene id transitions from A→B, A is recorded as previous.
  const lastAnnouncedScene = new Map<string, string>();
  const previousSceneByDisplay = new Map<string, string>();
  /** Wall-clock time of the most recent scene change per display. Reactive
   *  HA-driven re-pushes that fall inside the transition window
   *  (TRANSITION_QUIET_MS) are deferred so the in-flight CSS animation isn't
   *  competing with main-thread JSON parsing + Svelte rerenders. */
  const lastSceneChangeAt = new Map<string, number>();

  const canvasExtras = createCanvasExtrasStore();
  const displayPalette = createDisplayPaletteStore();
  const calendarCache = resolveCalendarEvents
    ? createCalendarCache(resolveCalendarEvents)
    : null;
  const interest = createInterestSet({ displays, scenes, canvasExtras });
  interest.recompute();

  const onSceneChanged = (
    displayId: string,
    opts?: { skipHistory?: boolean; explicitTransitionId?: string | null }
  ) => {
    const cur = displays.getById(displayId)?.currentSceneId ?? '';
    // Alert fire/revert pass skipHistory=true so transient alert scenes don't
    // pollute scene/last history. (Without this, the post-revert scene/last
    // would jump back to the alert.)
    if (!opts?.skipHistory) {
      const prev = lastAnnouncedScene.get(displayId);
      if (prev && prev !== cur) previousSceneByDisplay.set(displayId, prev);
      if (cur) lastAnnouncedScene.set(displayId, cur);
    }
    lastSceneChangeAt.set(displayId, Date.now());
    interest.recompute();
    // Alert manager always passes skipHistory:true; treat that path as 'alert'
    // so the push log distinguishes timed alert swaps from regular scene changes.
    const reason = opts?.skipHistory ? 'alert' : 'scene-change';
    wssRef
      ?.pushSceneTo(displayId, { explicitTransitionId: opts?.explicitTransitionId, reason })
      .catch((err) => console.error('pushSceneTo failed', err));
  };

  // Server-side alert manager: timed scene swap with auto-revert. Manual
  // scene changes (REST + MQTT scene/set + scene/last) cancel any active
  // alert before mutating state.
  const alertManager = createAlertManager({ displays, onSceneChanged });

  /** Activate the previous scene for a display. Returns true if a previous
   *  scene existed and is still valid; false otherwise (no-op). */
  function activateLastScene(displayId: string): boolean {
    const prevId = previousSceneByDisplay.get(displayId);
    if (!prevId) return false;
    if (!scenes.get(prevId)) return false;
    alertManager.cancel(displayId);
    displays.setCurrentScene(displayId, prevId);
    onSceneChanged(displayId);
    return true;
  }

  // Per-display rotation scheduler.
  const rotationTimers = new Map<string, ReturnType<typeof setInterval>>();
  const rotationCursors = new Map<string, number>();
  function stopRotation(displayId: string) {
    const t = rotationTimers.get(displayId);
    if (t) {
      clearInterval(t);
      rotationTimers.delete(displayId);
    }
    rotationCursors.delete(displayId);
  }
  function tickRotation(displayId: string) {
    const d = displays.getById(displayId);
    if (!d?.rotation?.enabled || d.rotation.sceneIds.length === 0) {
      stopRotation(displayId);
      return;
    }
    const idx = (rotationCursors.get(displayId) ?? -1) + 1;
    const sceneId = d.rotation.sceneIds[idx % d.rotation.sceneIds.length];
    rotationCursors.set(displayId, idx);
    if (!scenes.get(sceneId)) return;
    displays.setCurrentScene(displayId, sceneId);
    interest.recompute();
    void wssRef?.pushSceneTo(displayId, { reason: 'rotation' }).catch((err) => console.error('rotation push failed', err));
  }
  function startRotation(displayId: string) {
    stopRotation(displayId);
    const d = displays.getById(displayId);
    if (!d?.rotation?.enabled || d.rotation.sceneIds.length === 0) return;
    const intervalMs = Math.max(5_000, d.rotation.intervalSec * 1000);
    rotationTimers.set(displayId, setInterval(() => tickRotation(displayId), intervalMs));
  }
  function onRotationChanged(displayId: string) {
    startRotation(displayId);
  }

  const app = await buildHttpApp({
    displays,
    settings,
    scenes,
    transitions,
    overrides,
    designs,
    haClient,  // pass the live client (or null) so /api/ha/entities can read the cache
    haUrl: effectiveHaUrl,    // server-reachable HA URL (LAN or http://supervisor/core) for the media proxy
    haToken: effectiveHaToken, // matching auth token for the proxy's upstream fetches
    moodsDir: () => resolveMoodsDir({ explicit: config.moodsDir, staticDir: config.staticDir, repoRoot: __cosmos_repo_root }),
    onSceneChanged,
    onSettingsChanged: () => wssRef?.pushSettingsChanged().catch((err) => console.error('pushSettingsChanged failed', err)),
    onRotationChanged,
    onDisplayConfigChanged: (displayId) => wssRef?.pushDisplayConfigTo(displayId),
    onScenesListChanged,
    onScenesMutated: () => {
      gcCanvasResolver();
      interest.recompute();
    },
    onDisplayDeleted,
    canvasExtras,
    calendarCache,
    onCanvasExtrasChanged: (displayName) => {
      const d = displays.getByName(displayName);
      if (d) markDisplayDirty(d.id);
      interest.recompute();
    },
    displayPalette,
    onPaletteChanged: (displayId) => markDisplayDirty(displayId),
    alerts: alertManager,
    docsDir: resolvePath(__cosmos_repo_root, 'docs'),
    homeAssistant: {
      source: effectiveHa.source,
      activeUrl: effectiveHaUrl,
      connected: haClient !== null,
      envConfigured: !!(config.haUrl && config.haToken),
      supervisorAvailable: !!config.supervisorToken,
    },
    // Scene-preview assembly for the admin editor's hover/tap previews. Uses
    // the same stateless data resolvers the WS hub uses (so widgets show real
    // HA values when connected, mock otherwise), but NOT the canvas resolver
    // — calling it from a one-off preview would clobber a live display's
    // template subscription for the same widget id. Canvas widgets therefore
    // preview with their {{ }} templates unsubstituted.
    assembleScenePreview: (scene) =>
      buildSceneState(scene, readSafeArea(settings), {
        resolveEntity,
        resolveCalendarEvents,
        resolveHistory,
        resolveWeatherForecasts,
        resolveCameraCapabilities,
        readEntitySync,
        mediaUrlBase: effectiveHa.source === 'environment' || effectiveHa.source === 'manual'
          ? effectiveHaUrl ?? undefined
          : undefined,
      }),
  });
  await registerStatic(app, config.staticDir, {
    devProxyTo: process.env.COSMOS_DEV_VITE_URL,
  });
  async function publishDiscovery(): Promise<void> {
    if (!mqttClient) return;
    const { buildDiscoveryPayloads } = await import('./mqtt/discovery.js');
    const list = displays.list().map((d) => ({ id: d.id, name: d.name }));
    const sceneNames = scenes.list().map((s) => s.name);
    for (const p of buildDiscoveryPayloads(list, sceneNames)) {
      mqttClient.publish(p.topic, p.payload, { retain: p.retain });
    }
  }
  let publishedDiscoveryOnce = false;
  function publishOnline(displayId: string, _name: string) {
    mqttClient?.publish(`cosmos/${displayId}/online`, 'online', { retain: true });
    if (mqttClient && !publishedDiscoveryOnce) {
      publishedDiscoveryOnce = true;
      void publishDiscovery().catch((err) => console.error('publishDiscovery failed', err));
    }
  }
  function onScenesListChanged() {
    void publishDiscovery().catch((err) => console.error('publishDiscovery failed', err));
  }

  /** Called when a display row is deleted. Tears down all in-memory and
   *  MQTT state for that display so HA stops showing its entities. */
  function onDisplayDeleted(displayId: string, _name: string) {
    stopRotation(displayId);
    lastAnnouncedScene.delete(displayId);
    previousSceneByDisplay.delete(displayId);
    interest.recompute();
    if (mqttClient) {
      const id = displayId;
      const discoveryTopics = [
        `homeassistant/sensor/cosmos_${id}_current_scene/config`,
        `homeassistant/binary_sensor/cosmos_${id}_online/config`,
        `homeassistant/notify/cosmos_${id}_show_message/config`,
        `homeassistant/button/cosmos_${id}_dismiss_message/config`,
        `homeassistant/button/cosmos_${id}_last_scene/config`,
        `homeassistant/select/cosmos_${id}_active_scene/config`,
      ];
      // Empty retained payload tells HA's MQTT integration to forget the
      // entity. Same trick for the per-display state topics.
      for (const t of discoveryTopics) mqttClient.publish(t, '', { retain: true });
      mqttClient.publish(`cosmos/${id}/online`, '', { retain: true });
      mqttClient.publish(`cosmos/${id}/current_scene`, '', { retain: true });
    }
  }
  function publishOffline(displayId: string, _name: string) {
    mqttClient?.publish(`cosmos/${displayId}/online`, 'offline', { retain: true });
  }
  function publishSceneState(displayId: string, sceneName: string | null) {
    mqttClient?.publish(`cosmos/${displayId}/current_scene`, sceneName ?? '', { retain: true });
  }

  // Browser-reachable HA URL for media art absolutization. Only set when
  // HA was configured directly (not via Supervisor) — `http://supervisor/core`
  // is server-side only and unreachable from a tablet's browser. In add-on
  // setups we'd need a Cosmos-side proxy endpoint instead.
  const browserMediaBase =
    effectiveHa.source === 'environment' || effectiveHa.source === 'manual'
      ? effectiveHaUrl
      : null;

  // Debounce reactive scene pushes: many HA entities can change in one tick.
  // We coalesce per-display dirty flags and flush them ~50ms later in one batch.
  const dirtyDisplays = new Set<string>();
  let dirtyFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce window for entity-driven re-pushes. 250 ms is well below human
   *  perception for ambient state updates and caps push rate at 4 Hz, which
   *  is plenty for a wall display. Below this, a chatty entity (e.g. power
   *  meter ticking every 100 ms) saturates the WS and the display's main
   *  thread can't keep up with the CSS animation pipeline. */
  const DIRTY_FLUSH_MS = 250;
  /** Base quiet-window duration in ms — sized to cover the longest builtin
   *  transition (~1100 ms) at 1× speed, with a small buffer. The actual
   *  window scales with the global transition-speed multiplier so it always
   *  outlasts the in-flight animation, no matter how slow the user picks. */
  const TRANSITION_QUIET_BASE_MS = 1200;
  function transitionQuietMs(): number {
    return Math.round(TRANSITION_QUIET_BASE_MS * readTransitionSpeed(settings));
  }
  function markDisplayDirty(displayId: string) {
    dirtyDisplays.add(displayId);
    if (dirtyFlushTimer) return;
    dirtyFlushTimer = setTimeout(flushDirty, DIRTY_FLUSH_MS);
  }
  function flushDirty() {
    dirtyFlushTimer = null;
    const now = Date.now();
    const ids = Array.from(dirtyDisplays);
    const quietMs = transitionQuietMs();
    let earliestUnblock = Infinity;
    for (const id of ids) {
      const since = now - (lastSceneChangeAt.get(id) ?? 0);
      if (since < quietMs) {
        // Keep this id in the dirty set; we'll retry once the transition window closes.
        earliestUnblock = Math.min(earliestUnblock, quietMs - since);
        if (process.env.LOG_PUSHES === '1') {
          const name = displays.getById(id)?.name ?? id;
          console.log(`[push-deferred] display=${name} waitMs=${quietMs - since} reason=transition-quiet`);
        }
        continue;
      }
      dirtyDisplays.delete(id);
      wssRef?.pushSceneTo(id, { reason: 'reactive' }).catch((err) => console.error('pushSceneTo failed', err));
    }
    if (dirtyDisplays.size > 0 && Number.isFinite(earliestUnblock)) {
      dirtyFlushTimer = setTimeout(flushDirty, earliestUnblock);
    }
  }

  const templatesClient = haClient ? createTemplatesClient(haClient.connection) : null;
  const canvasResolver = createCanvasResolver(templatesClient, (widgetId) => {
    // Mark every display whose active scene contains this widget dirty.
    for (const d of displays.list()) {
      const activeId = d.currentSceneId ?? d.defaultSceneId;
      if (!activeId) continue;
      const scene = scenes.get(activeId);
      if (!scene) continue;
      if (scene.widgets.some((w) => w.id === widgetId)) markDisplayDirty(d.id);
    }
  });

  const wss = attachWsHub(app.server, {
    displays, scenes, settings, transitions, overrides, displayPalette,
    resolveEntity,
    resolveCalendarEvents,
    resolveHistory,
    resolveWeatherForecasts,
    resolveCameraCapabilities,
    readEntitySync,
    mediaUrlBase: browserMediaBase ?? undefined,
    onDisplayOnline: publishOnline,
    onDisplayOffline: publishOffline,
    onDisplayRegistered: () => interest.recompute(),
    onSceneActivated: publishSceneState,
    canvasResolver,
    canvasExtras: (widgetId) => {
      const all: string[] = [];
      for (const d of displays.list()) all.push(...canvasExtras.list(d.name, widgetId));
      return all;
    },
    canvasExtrasOnDisconnect: (displayName) => canvasExtras.clearDisplay(displayName),
    canvasExtrasPruneForDisplay: (displayName, keepWidgetIds) =>
      canvasExtras.pruneDisplay(displayName, keepWidgetIds),
  });
  wssRef = wss;

  /** Drop HA template subscriptions for canvas widgets that no longer exist
   *  in any stored scene. Called after scene/widget mutations — without
   *  this, removing a canvas widget leaves its subscription firing
   *  onUpdate(widgetId) for every entity tick, queuing scene re-pushes
   *  that the display will then have to discard. */
  function gcCanvasResolver() {
    const live = new Set<string>();
    for (const s of scenes.list()) {
      for (const w of s.widgets) {
        if (w.kind === 'canvas') live.add(w.id);
      }
    }
    canvasResolver.gc(live);
  }

  let unsubHaStateChange: (() => void) | null = null;
  if (haClient) {
    unsubHaStateChange = haClient.onStateChanged((entity) => {
      if (!interest.has(entity.entity_id)) return;
      const usedIds = widgetEntityIds(scenes);
      const widgetUses = usedIds.has(entity.entity_id);
      for (const d of displays.list()) {
        const activeId = d.currentSceneId ?? d.defaultSceneId;
        if (!activeId) continue;
        const scene = scenes.get(activeId);
        if (!scene) continue;
        const widgetMatches =
          widgetUses &&
          scene.widgets.some((w) => (w.config as { entity_id?: string }).entity_id === entity.entity_id);
        const ambientMatches = sceneAmbientEntityIds(scene).has(entity.entity_id);
        // Canvas widgets can subscribe to entities via cosmos.subscribe(...)
        // that no other widget references. The extras store tracks those per
        // display; if THIS display has the changing entity in its extras AND
        // its active scene actually contains a canvas widget, re-push.
        const sceneHasCanvas = scene.widgets.some((w) => w.kind === 'canvas');
        const canvasMatches =
          sceneHasCanvas && canvasExtras.entitiesForDisplay(d.name).has(entity.entity_id);
        if (widgetMatches || ambientMatches || canvasMatches) markDisplayDirty(d.id);
      }
    });
  }

  function resolveTargetDisplays(target: string): { id: string; name: string }[] {
    if (target === 'all') return displays.list().map((d) => ({ id: d.id, name: d.name }));
    const decoded = decodeURIComponent(target);
    const byName = displays.getByName(decoded);
    if (byName) return [{ id: byName.id, name: byName.name }];
    const byId = displays.getById(decoded);
    if (byId) return [{ id: byId.id, name: byId.name }];
    return [];
  }

  function dispatchOverlay(target: string, message: import('./overlay/types.js').OverlayMessage) {
    for (const d of resolveTargetDisplays(target)) wssRef?.pushOverlayTo(d.id, message);
  }
  function dispatchDismiss(target: string) {
    for (const d of resolveTargetDisplays(target)) wssRef?.dismissOverlayFor(d.id);
  }
  function dispatchShowScene(target: string, sceneName: string) {
    const scene = scenes.getByName(sceneName);
    if (!scene) return;
    for (const d of resolveTargetDisplays(target)) {
      alertManager.cancel(d.id);
      displays.setCurrentScene(d.id, scene.id);
      wssRef?.pushSceneTo(d.id, { reason: 'scene-change' }).catch((err) => console.error('pushSceneTo failed', err));
    }
  }
  function dispatchShowSceneAlert(
    target: string,
    sceneName: string,
    dwellMs: number,
    transitionId?: string
  ) {
    const scene = scenes.getByName(sceneName);
    if (!scene) {
      console.warn(`alert: scene "${sceneName}" not found`);
      return;
    }
    for (const d of resolveTargetDisplays(target)) {
      alertManager.fire(d.id, scene.id, dwellMs, { explicitTransitionId: transitionId ?? null });
    }
  }

  // ── Per-display alert config (scene + dwell) ─────────────────────────────
  // Persisted in `settings` as JSON keyed by display id. HA writes to these
  // via the select/number entities; the button reads them back.
  const ALERT_CONFIG_PREFIX = 'alert_config_';
  const DEFAULT_ALERT_DWELL_SEC = 5;
  function readAlertConfig(displayId: string): { sceneName: string | null; dwellSec: number } {
    const raw = settings.get(ALERT_CONFIG_PREFIX + displayId);
    if (!raw) return { sceneName: null, dwellSec: DEFAULT_ALERT_DWELL_SEC };
    try {
      const v = JSON.parse(raw) as { sceneName?: unknown; dwellSec?: unknown };
      return {
        sceneName: typeof v.sceneName === 'string' ? v.sceneName : null,
        dwellSec:
          typeof v.dwellSec === 'number' && v.dwellSec > 0 ? v.dwellSec : DEFAULT_ALERT_DWELL_SEC,
      };
    } catch {
      return { sceneName: null, dwellSec: DEFAULT_ALERT_DWELL_SEC };
    }
  }
  function writeAlertConfig(displayId: string, cfg: { sceneName: string | null; dwellSec: number }) {
    settings.set(ALERT_CONFIG_PREFIX + displayId, JSON.stringify(cfg));
  }
  function publishAlertState(displayId: string) {
    if (!mqttClient) return;
    const cfg = readAlertConfig(displayId);
    if (cfg.sceneName) {
      mqttClient.publish(`cosmos/${displayId}/alert/scene`, cfg.sceneName, { retain: true });
    }
    mqttClient.publish(`cosmos/${displayId}/alert/dwell`, String(cfg.dwellSec), { retain: true });
  }
  function dispatchSetAlertScene(target: string, sceneName: string) {
    for (const d of resolveTargetDisplays(target)) {
      const cfg = readAlertConfig(d.id);
      writeAlertConfig(d.id, { ...cfg, sceneName });
      publishAlertState(d.id);
    }
  }
  function dispatchSetAlertDwell(target: string, dwellSec: number) {
    for (const d of resolveTargetDisplays(target)) {
      const cfg = readAlertConfig(d.id);
      writeAlertConfig(d.id, { ...cfg, dwellSec });
      publishAlertState(d.id);
    }
  }
  function dispatchFireAlert(target: string) {
    for (const d of resolveTargetDisplays(target)) {
      const cfg = readAlertConfig(d.id);
      // Fall back to the first available scene name if the user never picked one.
      const sceneName = cfg.sceneName ?? scenes.list()[0]?.name;
      if (!sceneName) {
        console.warn(`alert: no scene configured and no scenes exist for ${d.name}`);
        continue;
      }
      const scene = scenes.getByName(sceneName);
      if (!scene) {
        console.warn(`alert: configured scene "${sceneName}" not found for ${d.name}`);
        continue;
      }
      alertManager.fire(d.id, scene.id, cfg.dwellSec * 1000);
    }
  }

  if (effectiveMqttUrl) {
    try {
      console.log(`connecting to MQTT at ${effectiveMqttUrl.replace(/:[^:@/]*@/, ':***@')}`);
      const { makeMqttClient } = await import('./mqtt/client.js');
      mqttClient = await makeMqttClient(effectiveMqttUrl);
      console.log('MQTT connected');

      const { buildDiscoveryPayloads } = await import('./mqtt/discovery.js');
      const { parseCommandTopic } = await import('./mqtt/commands.js');

      function publishDiscovery() {
        if (!mqttClient) return;
        const list = displays.list().map((d) => ({ id: d.id, name: d.name }));
        for (const p of buildDiscoveryPayloads(list)) {
          mqttClient.publish(p.topic, p.payload, { retain: p.retain });
        }
      }
      publishDiscovery();

      mqttClient.subscribe('cosmos/+/message/set', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'show_message') return;
        dispatchOverlay(cmd.target, cmd.message);
      });
      mqttClient.subscribe('cosmos/+/message/dismiss', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'dismiss_message') return;
        dispatchDismiss(cmd.target);
      });
      mqttClient.subscribe('cosmos/+/scene/set', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'show_scene') return;
        dispatchShowScene(cmd.target, cmd.sceneName);
      });
      mqttClient.subscribe('cosmos/+/scene/last', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'last_scene') return;
        for (const d of resolveTargetDisplays(cmd.target)) activateLastScene(d.id);
      });
      mqttClient.subscribe('cosmos/+/scene/alert', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'show_scene_alert') return;
        dispatchShowSceneAlert(cmd.target, cmd.sceneName, cmd.dwellMs, cmd.transitionId);
      });
      mqttClient.subscribe('cosmos/+/alert/scene/set', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'set_alert_scene') return;
        dispatchSetAlertScene(cmd.target, cmd.sceneName);
      });
      mqttClient.subscribe('cosmos/+/alert/dwell/set', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'set_alert_dwell') return;
        dispatchSetAlertDwell(cmd.target, cmd.dwellSec);
      });
      mqttClient.subscribe('cosmos/+/alert/fire', (topic, payload) => {
        const cmd = parseCommandTopic(topic, payload);
        if (cmd?.kind !== 'fire_alert') return;
        dispatchFireAlert(cmd.target);
      });

      // Republish the persisted alert state for every display so HA's
      // select/number entities show the right values right after discovery.
      for (const d of displays.list()) publishAlertState(d.id);
    } catch (err) {
      console.error('MQTT connection failed; overlay/scene commands unavailable', err);
      mqttClient = null;
    }
  } else {
    console.log('MQTT not configured; overlay commands unavailable');
  }

  await app.listen({ port: config.port, host: config.host });
  console.log(`cosmos server listening on http://${config.host}:${config.port}`);

  // Start rotations for any display that already has one configured.
  for (const d of displays.list()) {
    if (d.rotation?.enabled) startRotation(d.id);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`received ${signal}, shutting down`);
    try {
      for (const t of rotationTimers.values()) clearInterval(t);
      rotationTimers.clear();
      alertManager.clearAll();
      wss.close();
      await app.close();
      unsubHaStateChange?.();
      // Tear down template subscriptions while the HA socket is still live
      // so `unsubscribe` messages actually reach HA.
      canvasResolver.dispose();
      templatesClient?.close();
      await haClient?.close();
      await mqttClient?.close();
      db.close();
    } catch (err) {
      console.error('error during shutdown', err);
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

// Defense in depth: never let a stray promise rejection from a third-party
// library (notably home-assistant-js-websocket, which sometimes leaks
// rejections during reconnect storms) crash the addon. Logged loudly, then
// swallowed. Without this, Node's default behavior is process.exit(1) on
// any unhandled rejection, which on the HA add-on triggers Supervisor to
// restart the container — visible to the user as a kiosk WS reconnect and
// scene re-render every time the HA WS hiccups.
process.on('unhandledRejection', (reason, promise) => {
  console.error('unhandledRejection', reason, 'promise:', promise);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
