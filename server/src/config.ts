import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

export const config = {
  port: Number(process.env.PORT ?? 8099),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? resolve(repoRoot, 'data', 'cosmos.db'),
  staticDir: process.env.STATIC_DIR ?? resolve(repoRoot, 'display', 'build'),
  /** Folder scanned for mood video files. Defaults to <staticDir>/moods if it
   *  exists, otherwise falls back to display/static/moods (dev). */
  moodsDir: process.env.MOODS_DIR ?? null,
  haUrl: process.env.HA_URL ?? null,
  haToken: process.env.HA_TOKEN ?? null,
  mqttUrl: process.env.MQTT_URL ?? null,
  supervisorToken: process.env.SUPERVISOR_TOKEN ?? null,
  /**
   * Where downloaded video-backdrop files live.
   *
   * Deliberately NOT under /data in the add-on: Home Assistant includes an
   * add-on's /data in its backups, so caching hundreds of megabytes of video
   * there would silently inflate every snapshot the user takes. run.sh points
   * this at /share instead; dev falls back to the repo's data dir.
   */
  videoCacheDir: process.env.VIDEO_CACHE_DIR ?? resolve(repoRoot, 'data', 'video-cache'),
};
