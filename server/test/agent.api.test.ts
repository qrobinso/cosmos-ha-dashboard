import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';
import { buildHttpApp } from '../src/api/http.js';
import { createCanvasExtrasStore } from '../src/api/canvases.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const settings = createSettingsRepo(db);
  // Set the agent key so the chat route doesn't 503 before our validation runs.
  settings.set('agent_openrouter_key', 'sk-test');
  return {
    displays: createDisplaysRepo(db),
    settings,
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
    designs: createDesignPacksRepo(db),
    canvasExtras: createCanvasExtrasStore(),
  };
}

describe('POST /api/agent/chat designPackSlug validation', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    app = await buildHttpApp(ctx);
  });

  it('400s when designPackSlug is provided but unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }], designPackSlug: 'not-real' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/design pack/i);
  });
});
