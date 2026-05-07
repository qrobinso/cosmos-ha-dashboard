import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerDocsRoutes } from '../src/api/docs.js';
import { createFakeHaClient } from '../src/ha/fakeClient.js';

function makeApp(haEntities: { entity_id: string; state: string; attributes?: Record<string, unknown> }[] | null): { app: FastifyInstance } {
  const docsDir = mkdtempSync(join(tmpdir(), 'cosmos-docs-'));
  mkdirSync(docsDir, { recursive: true });
  // One real markdown file so the listing handler doesn't 503.
  writeFileSync(join(docsDir, 'sample.md'), '# Sample\n\nbody\n');
  const haClient = haEntities === null ? null : createFakeHaClient(haEntities.map((e) => ({
    entity_id: e.entity_id,
    state: e.state,
    attributes: e.attributes ?? {},
  })));
  const app = Fastify({ logger: false });
  registerDocsRoutes(app, { docsDir, haClient });
  return { app };
}

describe('docs ha-entities synthetic doc', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const built = makeApp([
      { entity_id: 'sensor.power', state: '1247', attributes: { friendly_name: 'Power', unit_of_measurement: 'W', device_class: 'power' } },
      { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen', brightness: 192 } },
      { entity_id: 'sensor.living_temp', state: '21.5', attributes: { friendly_name: 'Living Temp', unit_of_measurement: '°C' } },
    ]);
    app = built.app;
    await app.ready();
  });

  it('lists ha-entities in the index', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ slug: string; title: string }>;
    const haEntry = body.find((e) => e.slug === 'ha-entities');
    expect(haEntry).toBeDefined();
    expect(haEntry!.title).toMatch(/Home Assistant entities/i);
  });

  it('renders entities grouped by domain with friendly names + units', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/ha-entities' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    const md = res.body;
    // Domain headings
    expect(md).toContain('## sensor (2)');
    expect(md).toContain('## light (1)');
    // Entity rows
    expect(md).toContain('`sensor.power`');
    expect(md).toContain('`light.kitchen`');
    expect(md).toContain('1247');
    expect(md).toContain('W');
    expect(md).toContain('°C');
    // Summary line
    expect(md).toMatch(/\*\*3\*\* entities across \*\*2\*\* domains/);
  });

  it('returns an explanation when HA is not connected', async () => {
    const built = makeApp(null);
    await built.app.ready();
    const res = await built.app.inject({ method: 'GET', url: '/api/docs/ha-entities' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/Home Assistant is not connected/i);
  });
});
