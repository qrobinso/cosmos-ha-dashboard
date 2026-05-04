import { describe, it, expect } from 'vitest';
import { createEntityCache } from '../src/ha/cache.js';
import { createFakeHaClient } from '../src/ha/fakeClient.js';

describe('entity cache', () => {
  it('set + get round-trips', () => {
    const c = createEntityCache();
    c.set({ entity_id: 'light.kitchen', state: 'on', attributes: {} });
    expect(c.get('light.kitchen')?.state).toBe('on');
    expect(c.get('light.unknown')).toBeNull();
  });

  it('emitChange notifies subscribers and updates the cached value', () => {
    const c = createEntityCache();
    c.set({ entity_id: 'light.kitchen', state: 'off', attributes: {} });
    let last: string | null = null;
    const off = c.onChange((e) => (last = e.state));
    c.emitChange({ entity_id: 'light.kitchen', state: 'on', attributes: { brightness: 200 } });
    expect(last).toBe('on');
    expect(c.get('light.kitchen')?.attributes.brightness).toBe(200);
    off();
    c.emitChange({ entity_id: 'light.kitchen', state: 'off', attributes: {} });
    expect(last).toBe('on'); // unsubscribed handler did not fire
  });
});

describe('fake HA client', () => {
  it('seeded entities are queryable via getEntity', () => {
    const ha = createFakeHaClient([
      { entity_id: 'sensor.outside_temp', state: '14.5', attributes: { unit_of_measurement: '°C' } },
    ]);
    expect(ha.getEntity('sensor.outside_temp')?.state).toBe('14.5');
    expect(ha.getEntity('sensor.missing')).toBeNull();
  });

  it('emit triggers subscribers', () => {
    const ha = createFakeHaClient();
    let fired = 0;
    ha.onStateChanged(() => (fired += 1));
    ha.emit({ entity_id: 'light.x', state: 'on', attributes: {} });
    expect(fired).toBe(1);
  });
});
