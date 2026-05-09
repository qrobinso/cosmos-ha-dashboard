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

const sample = {
  slug: 'minimal',
  name: 'Minimal',
  content: '---\nname: Minimal\ncolors:\n  bg: "#000000"\n  text: "#ffffff"\ntypography:\n  body:\n    fontFamily: Inter\n---\n\n# Body',
};

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const designs = createDesignPacksRepo(db);
  // Pre-seed one builtin so we can test the protect-builtin behaviour.
  designs.seedBuiltinsFromMap({
    'house': { name: 'House', content: '---\nname: House\n---\n\nBuilt-in.' },
  });
  return {
    displays: createDisplaysRepo(db),
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
    designs,
    canvasExtras: createCanvasExtrasStore(),
  };
}

describe('designs REST API', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => { ctx = setup(); app = await buildHttpApp(ctx); });

  it('GET /api/designs returns built-ins with preview shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/designs' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ slug: string; name: string; source: string; preview: { colors: string[]; font_family: string | null } }>;
    expect(body.length).toBe(1);
    expect(body[0].slug).toBe('house');
    expect(body[0].source).toBe('builtin');
    expect(body[0].preview).toBeDefined();
  });

  it('POST /api/designs creates a user pack', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBe('minimal');
    expect(body.source).toBe('user');
    const list = (await app.inject({ method: 'GET', url: '/api/designs' })).json() as Array<{ slug: string }>;
    expect(list.map((p) => p.slug).sort()).toEqual(['house', 'minimal']);
  });

  it('POST /api/designs 400s on duplicate slug', async () => {
    await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    const res = await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/slug/i);
  });

  it('POST /api/designs 400s on missing fields', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/designs', payload: { slug: 'a' } });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/designs/:slug returns full content + parsed frontmatter', async () => {
    await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    const res = await app.inject({ method: 'GET', url: '/api/designs/minimal' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe(sample.content);
    expect(body.frontmatter.name).toBe('Minimal');
    expect(body.body).toContain('# Body');
  });

  it('GET /api/designs/:id (uuid) also resolves', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/designs', payload: sample })).json();
    const res = await app.inject({ method: 'GET', url: `/api/designs/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe('minimal');
  });

  it('GET /api/designs/:slug returns 404 when missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/designs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/designs/:slug updates a user pack', async () => {
    await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    const res = await app.inject({
      method: 'PATCH', url: '/api/designs/minimal',
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Renamed');
  });

  it('PATCH /api/designs/:slug 403s on builtins', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/designs/house',
      payload: { name: 'Stomp' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /api/designs/:slug removes a user pack', async () => {
    await app.inject({ method: 'POST', url: '/api/designs', payload: sample });
    const del = await app.inject({ method: 'DELETE', url: '/api/designs/minimal' });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: '/api/designs/minimal' });
    expect(get.statusCode).toBe(404);
  });

  it('DELETE /api/designs/:slug 403s on builtins', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/designs/house' });
    expect(res.statusCode).toBe(403);
  });
});
