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
  attachWsHub(app.server, { displays });

  await app.listen({ port: config.port, host: config.host });
  console.log(`cosmos server listening on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
