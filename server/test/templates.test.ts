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

  it('shares one HA subscription across callers requesting the same template', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('A', { result: '1', listeners: { entities: ['x'], all: false, time: false } });
    const tc = createTemplatesClient(conn);
    const r1 = await tc.render('A', () => {});
    const r2 = await tc.render('A', () => {});
    expect(conn.countSubscriptions()).toBe(1);
    r1.unsubscribe();
    expect(conn.countSubscriptions()).toBe(1);  // still one caller left
    r2.unsubscribe();
    expect(conn.countSubscriptions()).toBe(0);  // last caller dropped → unsub
  });

  it('pushes updates to all subscribers when the template re-renders', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('B', { result: '1', listeners: { entities: ['x'], all: false, time: false } });
    const tc = createTemplatesClient(conn);
    const calls: string[] = [];
    await tc.render('B', (rendered) => calls.push(rendered));
    conn.pushUpdate('B', { result: '2', listeners: { entities: ['x'], all: false, time: false } });
    expect(calls).toEqual(['2']);
  });

  it('surfaces HA template errors as the rendered value', async () => {
    const conn = createFakeHaConnection();
    conn.queueRenderTemplate('OOPS', {
      result: '',
      listeners: { entities: [], all: false, time: false },
    });
    // Override: simulate HA returning an error response by pushing a message
    // with `error` and no `result`. We re-queue manually:
    const tc = createTemplatesClient(conn);
    // First the template is registered with the queued (empty) result, then
    // an error update arrives.
    const r = await tc.render('OOPS', () => {});
    expect(r.initial).toBe('');
    // The fake's pushUpdate calls all subscribers. We extend its message
    // shape to include `error`.
    let received = '';
    await tc.render('OOPS', (s) => { received = s; });
    (conn as unknown as { pushUpdate(t: string, msg: unknown): void }).pushUpdate('OOPS', {
      error: 'TemplateSyntaxError: unexpected end of template',
    });
    expect(received).toBe('TemplateSyntaxError: unexpected end of template');
  });
});
