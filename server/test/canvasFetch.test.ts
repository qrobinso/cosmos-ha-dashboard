import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDesignPacksRepo } from '../src/store/design-packs.js';
import { buildHttpApp } from '../src/api/http.js';
import {
  DEFAULT_CANVAS_FETCH_POLICY,
  isHostAllowed,
  normalizeCanvasFetchPolicy,
} from '../src/store/canvasFetch.js';

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

describe('canvas-fetch policy: pure helpers', () => {
  it('default is allowlist with empty list — equivalent to off until populated', () => {
    expect(DEFAULT_CANVAS_FETCH_POLICY).toEqual({ mode: 'allowlist', allowlist: [] });
    expect(isHostAllowed('example.com', DEFAULT_CANVAS_FETCH_POLICY)).toBe(false);
  });

  it('mode=any allows everything', () => {
    expect(isHostAllowed('whatever.invalid', { mode: 'any', allowlist: [] })).toBe(true);
  });

  it('mode=off blocks everything even with entries', () => {
    expect(isHostAllowed('example.com', { mode: 'off', allowlist: ['example.com'] })).toBe(false);
  });

  it('allowlist matches exact host and subdomains', () => {
    const p = { mode: 'allowlist' as const, allowlist: ['example.com'] };
    expect(isHostAllowed('example.com', p)).toBe(true);
    expect(isHostAllowed('api.example.com', p)).toBe(true);
    expect(isHostAllowed('a.b.example.com', p)).toBe(true);
    expect(isHostAllowed('notexample.com', p)).toBe(false);
    expect(isHostAllowed('example.com.evil.com', p)).toBe(false);
  });

  it('matching is case-insensitive', () => {
    const p = { mode: 'allowlist' as const, allowlist: ['Example.COM'] };
    // normalize lowercases entries on the way in; isHostAllowed lowercases the input
    const norm = normalizeCanvasFetchPolicy(p);
    expect(norm.allowlist).toEqual(['example.com']);
    expect(isHostAllowed('API.Example.com', norm)).toBe(true);
  });

  it('normalize strips scheme, port, path from entries', () => {
    const out = normalizeCanvasFetchPolicy({
      mode: 'allowlist',
      allowlist: ['https://api.example.com:443/feed', 'http://other.test/'],
    });
    expect(out.allowlist).toEqual(['api.example.com', 'other.test']);
  });

  it('normalize dedupes and drops blanks/junk', () => {
    const out = normalizeCanvasFetchPolicy({
      mode: 'allowlist',
      allowlist: ['example.com', 'EXAMPLE.com', '', '  ', 'spaces in host', 'example.com'],
    });
    expect(out.allowlist).toEqual(['example.com']);
  });

  it('normalize coerces unknown mode to allowlist', () => {
    const out = normalizeCanvasFetchPolicy({ mode: 'WHATEVER', allowlist: [] });
    expect(out.mode).toBe('allowlist');
  });
});

describe('canvas-fetch policy: REST endpoints', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  beforeEach(async () => {
    app = await buildHttpApp(setup());
  });

  it('GET returns the default when unset', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/canvas-fetch' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_CANVAS_FETCH_POLICY);
  });

  it('PUT persists a normalized policy', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/canvas-fetch',
      payload: { mode: 'allowlist', allowlist: ['HTTPS://API.Example.com/feed', 'example.com'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: 'allowlist', allowlist: ['api.example.com', 'example.com'] });

    const get = await app.inject({ method: 'GET', url: '/api/settings/canvas-fetch' });
    expect(get.json()).toEqual({ mode: 'allowlist', allowlist: ['api.example.com', 'example.com'] });
  });

  it('PUT accepts mode=any with empty list', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/canvas-fetch',
      payload: { mode: 'any', allowlist: [] },
    });
    expect(res.json()).toEqual({ mode: 'any', allowlist: [] });
  });

  it('PUT rejects garbage payloads with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/canvas-fetch',
      payload: 'not-an-object',
      headers: { 'content-type': 'text/plain' },
    });
    expect(res.statusCode).toBe(400);
  });
});
