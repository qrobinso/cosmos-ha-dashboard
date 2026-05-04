import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { buildHttpApp, DEFAULT_SAFE_AREA } from '../src/api/http.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return {
    displays: createDisplaysRepo(db),
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
  };
}

describe('safe-area settings', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  beforeEach(async () => {
    app = await buildHttpApp(setup());
  });

  it('GET returns the default when unset', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/safe-area' });
    expect(res.json()).toEqual(DEFAULT_SAFE_AREA);
  });

  it('PUT merges and persists values', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/safe-area',
      payload: { top: 32, left: 24 },
    });
    expect(res.json()).toEqual({ ...DEFAULT_SAFE_AREA, top: 32, left: 24 });
    const get = await app.inject({ method: 'GET', url: '/api/settings/safe-area' });
    expect(get.json()).toEqual({ ...DEFAULT_SAFE_AREA, top: 32, left: 24 });
  });

  it('PUT rejects negative values', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/safe-area',
      payload: { top: -10 },
    });
    expect(res.statusCode).toBe(400);
  });
});
