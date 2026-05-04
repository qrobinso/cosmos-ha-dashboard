import { config } from './config.js';
import { openDatabase } from './store/db.js';
import { runMigrations } from './store/migrations.js';
import { createDisplaysRepo } from './store/displays.js';
import { createSettingsRepo } from './store/settings.js';
import { buildHttpApp } from './api/http.js';
import { attachWsHub } from './api/ws.js';
import { registerStatic } from './static.js';

async function main() {
  const db = openDatabase(config.dbPath);
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);

  const app = await buildHttpApp({ displays, settings });
  await registerStatic(app, config.staticDir);
  const wss = attachWsHub(app.server, { displays });

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
