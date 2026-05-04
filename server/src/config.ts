import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

export const config = {
  port: Number(process.env.PORT ?? 8099),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? resolve(repoRoot, 'data', 'cosmos.db'),
  staticDir: process.env.STATIC_DIR ?? resolve(repoRoot, 'display', 'build'),
  haUrl: process.env.HA_URL ?? null,
  haToken: process.env.HA_TOKEN ?? null,
  mqttUrl: process.env.MQTT_URL ?? null,
  supervisorToken: process.env.SUPERVISOR_TOKEN ?? null,
};
