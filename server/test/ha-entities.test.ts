import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';
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
      designs: createDesignPacksRepo(db),
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

  it('supports a search filter against entity_id and friendly_name', async () => {
    const ha = createFakeHaClient([
      { entity_id: 'sensor.kitchen_temp', state: '20', attributes: { friendly_name: 'Kitchen Temp' } },
      { entity_id: 'sensor.bedroom_temp', state: '19', attributes: { friendly_name: 'Bedroom Temp' } },
      { entity_id: 'light.cooktop', state: 'on', attributes: { friendly_name: 'Kitchen Cooktop' } },
    ]);
    const ctx = setup(ha);
    const app = await buildHttpApp(ctx.deps);
    const res = await app.inject({ method: 'GET', url: '/api/ha/entities?search=kitchen' });
    const ids = (res.json() as { entity_id: string }[]).map((e) => e.entity_id).sort();
    expect(ids).toEqual(['light.cooktop', 'sensor.kitchen_temp']);
  });

  it('supports a device_class filter', async () => {
    const ha = createFakeHaClient([
      { entity_id: 'sensor.a', state: '1', attributes: { device_class: 'temperature' } },
      { entity_id: 'sensor.b', state: '2', attributes: { device_class: 'humidity' } },
      { entity_id: 'sensor.c', state: '3', attributes: { device_class: 'temperature' } },
    ]);
    const ctx = setup(ha);
    const app = await buildHttpApp(ctx.deps);
    const res = await app.inject({ method: 'GET', url: '/api/ha/entities?device_class=temperature' });
    const ids = (res.json() as { entity_id: string }[]).map((e) => e.entity_id).sort();
    expect(ids).toEqual(['sensor.a', 'sensor.c']);
  });

  it('AND-combines multiple filters', async () => {
    const ha = createFakeHaClient([
      { entity_id: 'sensor.kitchen_temp', state: '20', attributes: { device_class: 'temperature', friendly_name: 'Kitchen Temp' } },
      { entity_id: 'sensor.bedroom_temp', state: '19', attributes: { device_class: 'temperature', friendly_name: 'Bedroom Temp' } },
      { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Light' } },
    ]);
    const ctx = setup(ha);
    const app = await buildHttpApp(ctx.deps);
    const res = await app.inject({
      method: 'GET',
      url: '/api/ha/entities?domain=sensor&device_class=temperature&search=kitchen',
    });
    const ids = (res.json() as { entity_id: string }[]).map((e) => e.entity_id);
    expect(ids).toEqual(['sensor.kitchen_temp']);
  });

  it('limits the result count when ?limit= is provided', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      entity_id: `sensor.s${i}`,
      state: '1',
      attributes: {},
    }));
    const ha = createFakeHaClient(entries);
    const ctx = setup(ha);
    const app = await buildHttpApp(ctx.deps);
    const res = await app.inject({ method: 'GET', url: '/api/ha/entities?limit=3' });
    const list = res.json() as unknown[];
    expect(list).toHaveLength(3);
  });
});

describe('GET /api/ha/entities/summary', () => {
  it('returns total + per-domain + per-device-class counts', async () => {
    const ha = createFakeHaClient([
      { entity_id: 'sensor.a', state: '1', attributes: { device_class: 'temperature' } },
      { entity_id: 'sensor.b', state: '2', attributes: { device_class: 'temperature' } },
      { entity_id: 'sensor.c', state: '3', attributes: { device_class: 'humidity' } },
      { entity_id: 'light.a', state: 'on', attributes: {} },
      { entity_id: 'light.b', state: 'off', attributes: {} },
    ]);
    const ctx = setup(ha);
    const app = await buildHttpApp(ctx.deps);
    const res = await app.inject({ method: 'GET', url: '/api/ha/entities/summary' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; domains: Record<string, number>; deviceClasses: Record<string, number> };
    expect(body.total).toBe(5);
    expect(body.domains).toEqual({ sensor: 3, light: 2 });
    expect(body.deviceClasses).toEqual({ temperature: 2, humidity: 1 });
  });
});
