import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDisplayPaletteStore } from '../src/store/displayPalette.js';
import { buildHttpApp } from '../src/api/http.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  displays.registerByName('kitchen-wall');
  return {
    displays,
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
  };
}

describe('palette endpoints', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let displayPalette: ReturnType<typeof createDisplayPaletteStore>;
  let changeEvents: string[];

  beforeEach(async () => {
    displayPalette = createDisplayPaletteStore();
    changeEvents = [];
    app = await buildHttpApp({
      ...setup(),
      displayPalette,
      onPaletteChanged: (displayId) => changeEvents.push(displayId),
    });
  });

  it('GET returns empty when nothing has been reported', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/displays/kitchen-wall/palette' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ colors: [], updatedAt: null });
  });

  it('POST stores a contribution and round-trips through GET', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000', '#00ff00', '#0000ff'] },
    });
    expect(post.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: '/api/displays/kitchen-wall/palette' });
    const body = get.json();
    expect(body.colors.length).toBeGreaterThan(0);
    expect(body.updatedAt).not.toBeNull();
  });

  it('POST fires onPaletteChanged exactly when the resolved set changes', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000'] },
    });
    expect(changeEvents.length).toBe(1);
    await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000'] },
    });
    expect(changeEvents.length).toBe(1);
  });

  it('POST rejects non-hex strings with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['not-a-color'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST rejects more than 5 colors with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#000000', '#111111', '#222222', '#333333', '#444444', '#555555'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST accepts empty colors as a clear', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000'] },
    });
    const clear = await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: [] },
    });
    expect(clear.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: '/api/displays/kitchen-wall/palette' });
    expect(get.json().colors).toEqual([]);
  });

  it('POST returns 404 for an unknown display', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/no-such-display/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000'] },
    });
    expect(res.statusCode).toBe(404);
  });
});
