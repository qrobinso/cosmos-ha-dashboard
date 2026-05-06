import { describe, it, expect } from 'vitest';
import { createTemplatesClient } from '../src/ha/templates.js';
import { createFakeHaConnection } from './helpers/fakeHaConn.js';

describe('TemplatesClient', () => {
  it('renders a template once and reports its dependent entities', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('Power: {{ states("sensor.power") }} W', {
      result: 'Power: 42 W',
      listeners: { entities: ['sensor.power'], all: false, time: false },
    });
    const tc = createTemplatesClient(conn);
    const r = await tc.render('Power: {{ states("sensor.power") }} W', () => {});
    expect(r.initial).toBe('Power: 42 W');
    expect(r.entityIds).toEqual(['sensor.power']);
  });
});
