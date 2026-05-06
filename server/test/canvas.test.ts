import { describe, it, expect } from 'vitest';
import { createCanvasResolver } from '../src/scenes/canvas.js';

describe('resolveCanvas', () => {
  it('returns content unchanged when no templates client is provided', async () => {
    const resolver = createCanvasResolver(null, () => {});
    const r = await resolver('w1', '<h1>Hello {{ states("sensor.power") }}</h1>');
    expect(r.resolved).toBe('<h1>Hello {{ states("sensor.power") }}</h1>');
    expect(r.entityIds).toEqual([]);
  });
});

import { createTemplatesClient } from '../src/ha/templates.js';
import { createFakeHaConnection } from './helpers/fakeHaConn.js';

describe('resolveCanvas with templates client', () => {
  it('renders templates and reports dependent entities', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('<p>{{ states("x") }}</p>', {
      result: '<p>42</p>',
      listeners: { entities: ['x'], all: false, time: false },
    });
    const tc = createTemplatesClient(conn);
    const resolver = createCanvasResolver(tc, () => {});
    const r = await resolver('w1', '<p>{{ states("x") }}</p>');
    expect(r.resolved).toBe('<p>42</p>');
    expect(r.entityIds).toEqual(['x']);
  });

  it('fires onUpdate when the underlying template re-renders', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('T', { result: '1', listeners: { entities: ['e'], all: false, time: false } });
    const tc = createTemplatesClient(conn);
    const updated: string[] = [];
    const resolver = createCanvasResolver(tc, (id) => updated.push(id));
    await resolver('wA', 'T');
    conn.pushUpdate('T', { result: '2', listeners: { entities: ['e'], all: false, time: false } });
    expect(updated).toEqual(['wA']);
  });

  it('drops the previous subscription when a widget re-resolves', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('A', { result: 'a', listeners: { entities: [], all: false, time: false } });
    conn.queueRenderTemplate('B', { result: 'b', listeners: { entities: [], all: false, time: false } });
    const tc = createTemplatesClient(conn);
    const resolver = createCanvasResolver(tc, () => {});
    await resolver('wX', 'A');
    expect(conn.countSubscriptions()).toBe(1);
    await resolver('wX', 'B');
    expect(conn.countSubscriptions()).toBe(1);  // A dropped, B registered
  });
});
