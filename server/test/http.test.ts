import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';
import { buildHttpApp } from '../src/api/http.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const scenes = createScenesRepo(db);
  const transitions = createTransitionsRepo(db);
  const overrides = createOverridesRepo(db);
  const designs = createDesignPacksRepo(db);
  return buildHttpApp({ displays, settings, scenes, transitions, overrides, designs });
}

describe('HTTP API', () => {
  let app: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    app = await setup();
  });

  it('POST /api/displays/register creates a display', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/register',
      payload: { name: 'Living Room' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Living Room');
    expect(typeof body.id).toBe('string');
  });

  it('POST /api/displays/register is idempotent for the same name', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Kitchen' } });
    const b = await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Kitchen' } });
    expect(a.json().id).toBe(b.json().id);
  });

  it('POST /api/displays/register rejects empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/register',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/displays lists registered displays', async () => {
    await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'A' } });
    await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'B' } });
    const res = await app.inject({ method: 'GET', url: '/api/displays' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((d: { name: string }) => d.name).sort()).toEqual(['A', 'B']);
  });
});
