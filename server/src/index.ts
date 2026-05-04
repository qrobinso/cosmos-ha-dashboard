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
  const wss = attachWsHub(app.server, { displays, scenes, settings, transitions, overrides, resolveEntity });
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
