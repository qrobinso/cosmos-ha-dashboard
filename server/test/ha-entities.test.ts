import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { buildHttpApp } from '../src/api/http.js';
import { createFakeHaClient } from '../src/ha/fakeClient.js';

function setup(haClient: ReturnType<typeof createFakeHaClient> | null) {
  const db = new Database(':memory:');
  runMigrations(db);
  return {
    deps: {
      displays: createDisplaysRepo(db),
      settings: createSettingsRepo(db),
      scenes: createScenesRepo(db),
      transitions: createTransitionsRepo(db),
      overrides: createOverridesRepo(db),
      haClient,
    },
  };
}

describe('GET /api/ha/entities', () => {
  it('returns mock entities when no HA client is connected', async () => {
    const ctx = setup(null);
    const app = await buildHttpApp(ctx.deps);
    const res = await app.inject({ method: 'GET', url: '/api/ha/entities' });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { entity_id: string }[];
    const ids = list.map((e) => e.entity_id);
    expect(ids).toContain('light.living_room');
    expect(ids).toContain('sensor.outside_temp');
  });

  it('returns cached HA entities when an HA client is connected', async () => {
    const ha = createFakeHaClient([
      { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen' } },
      { entity_id: 'sensor.real_temp', state: '21', attributes: {} },
    ]);
    const ctx = setup(ha);
    const app = await buildHttpApp(ctx.deps);
    const res = await app.inject({ method: 'GET', url: '/api/ha/entities' });
    const list = res.json() as { entity_id: string }[];
    const ids = list.map((e) => e.entity_id);
    expect(ids).toContain('light.kitchen');
    expect(ids).toContain('sensor.real_temp');
    // Mock entities are NOT included when HA is connected
    expect(ids).not.toContain('light.living_room');
  });

  it('supports a domain filter via query string', async () => {
    const ha = createFakeHaClient([
      { entity_id: 'light.a', state: 'on', attributes: {} },
      { entity_id: 'light.b', state: 'off', attributes: {} },
      { entity_id: 'sensor.c', state: '1', attributes: {} },
    ]);
    const ctx = setup(ha);
    const app = await buildHttpApp(ctx.deps);
    const res = await app.inject({ method: 'GET', url: '/api/ha/entities?domain=light' });
    const ids = (res.json() as { entity_id: string }[]).map((e) => e.entity_id).sort();
    expect(ids).toEqual(['light.a', 'light.b']);
  });
});
