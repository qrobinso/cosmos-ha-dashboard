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
  return {
    displays: createDisplaysRepo(db),
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
    designs: createDesignPacksRepo(db),
  };
}

describe('transitions REST API', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  beforeEach(async () => {
    app = await buildHttpApp(setup());
  });

  it('GET /api/transitions returns all 6 built-ins', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transitions' });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['cross-fade', 'dissolve', 'gradient-morph', 'scale-fade', 'slide-down', 'slide-up']);
  });

  it('GET /api/transitions/:id returns one descriptor', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transitions/builtin-dissolve' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('dissolve');
  });

  it('GET /api/transitions/:id returns 404 for missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/transitions/no-such' });
    expect(res.statusCode).toBe(404);
  });
});
