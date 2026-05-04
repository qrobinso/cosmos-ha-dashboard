import { config } from './config.js';
import { openDatabase } from './store/db.js';
import { runMigrations } from './store/migrations.js';
import { createDisplaysRepo } from './store/displays.js';
import { createSettingsRepo } from './store/settings.js';
import { createScenesRepo } from './store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from './store/transitions.js';
import { buildHttpApp } from './api/http.js';
import { attachWsHub } from './api/ws.js';
import { registerStatic } from './static.js';
import { makeHaClient } from './ha/client.js';
import type { HaClient } from './ha/types.js';
import { mockEntityResolver } from './scenes/assembler.js';

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

  let haClient: HaClient | null = null;
  if (config.haUrl && config.haToken) {
    try {
      console.log(`connecting to Home Assistant at ${config.haUrl}`);
      haClient = await makeHaClient({ url: config.haUrl, token: config.haToken });
      await haClient.ready();
      console.log('Home Assistant connected; entity cache populated');
    } catch (err) {
      console.error('Home Assistant connection failed; falling back to mock entity data', err);
      haClient = null;
    }
  } else {
    console.log('HA_URL/HA_TOKEN not set; using mock entity data');
  }

  const resolveEntity = haClient
    ? (entityId: string) => haClient!.getEntity(entityId) ?? mockEntityResolver(entityId)
    : mockEntityResolver;

  let wssRef: ReturnType<typeof attachWsHub> | null = null;
  const onSceneChanged = (displayId: string, opts?: { explicitTransitionId?: string | null }) =>
    void wssRef?.pushSceneTo(displayId, opts);

  const app = await buildHttpApp({
    displays,
    settings,
    scenes,
    transitions,
    overrides,
    onSceneChanged,
    onSettingsChanged: () => void wssRef?.pushSettingsChanged(),
  });
  await registerStatic(app, config.staticDir);
  function publishOnline(displayId: string, _name: string) {
    mqttClient?.publish(`cosmos/${displayId}/online`, 'online', { retain: true });
  }
  function publishOffline(displayId: string, _name: string) {
    mqttClient?.publish(`cosmos/${displayId}/online`, 'offline', { retain: true });
  }
  function publishSceneState(displayId: string, sceneName: string | null) {
    mqttClient?.publish(`cosmos/${displayId}/current_scene`, sceneName ?? '', { retain: true });
  }

  const wss = attachWsHub(app.server, {
    displays, scenes, settings, transitions, overrides, resolveEntity,
    onDisplayOnline: publishOnline,
    onDisplayOffline: publishOffline,
    onSceneActivated: publishSceneState,
  });
  wssRef = wss;

  // When HA emits a state change for an entity used by an active scene, re-push that scene.
  if (haClient) {
    haClient.onStateChanged((entity) => {
      const usedIds = widgetEntityIds(scenes);
      if (!usedIds.has(entity.entity_id)) return;
      for (const d of displays.list()) {
        const activeId = d.currentSceneId ?? d.defaultSceneId;
        if (!activeId) continue;
        const scene = scenes.get(activeId);
        if (!scene) continue;
        const usesIt = scene.widgets.some((w) => (w.config as { entity_id?: string }).entity_id === entity.entity_id);
        if (usesIt) void wssRef?.pushSceneTo(d.id);
      }
    });
  }

  // MQTT setup
  let mqttClient: import('./mqtt/types.js').MqttClient | null = null;

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
      displays.setCurrentScene(d.id, scene.id);
      void wssRef?.pushSceneTo(d.id);
    }
  }

  if (config.mqttUrl) {
    try {
      console.log(`connecting to MQTT at ${config.mqttUrl}`);
      const { makeMqttClient } = await import('./mqtt/client.js');
      mqttClient = await makeMqttClient(config.mqttUrl);
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
    } catch (err) {
      console.error('MQTT connection failed; overlay/scene commands unavailable', err);
      mqttClient = null;
    }
  } else {
    console.log('MQTT_URL not set; overlay commands unavailable');
  }

  await app.listen({ port: config.port, host: config.host });
  console.log(`cosmos server listening on http://${config.host}:${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`received ${signal}, shutting down`);
    try {
      wss.close();
      await app.close();
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
