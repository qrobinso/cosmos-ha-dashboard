import { describe, it, expect } from 'vitest';
import { buildDiscoveryPayloads, COSMOS_DEVICE_ID } from '../src/mqtt/discovery.js';

describe('buildDiscoveryPayloads', () => {
  it('emits a sensor + binary_sensor pair per display, with shared device metadata', () => {
    const out = buildDiscoveryPayloads([
      { id: 'd1', name: 'Living Room' },
      { id: 'd2', name: 'Kitchen' },
    ]);

    // 2 displays * 2 entities = 4 discovery topics
    expect(out.length).toBe(4);

    const sensorTopics = out.filter((p) => p.topic.includes('/sensor/'));
    expect(sensorTopics.length).toBe(2);
    const binTopics = out.filter((p) => p.topic.includes('/binary_sensor/'));
    expect(binTopics.length).toBe(2);

    const livingScene = out.find((p) => p.topic === `homeassistant/sensor/cosmos_d1_current_scene/config`);
    expect(livingScene).toBeDefined();
    const cfg = JSON.parse(livingScene!.payload);
    expect(cfg.name).toBe('Living Room Scene');
    expect(cfg.state_topic).toBe('cosmos/d1/current_scene');
    expect(cfg.unique_id).toBe('cosmos_d1_current_scene');
    expect(cfg.device.identifiers).toContain(COSMOS_DEVICE_ID);
  });

  it('emits an availability topic per display', () => {
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }]);
    const onlineCfg = JSON.parse(
      out.find((p) => p.topic.endsWith('cosmos_d1_online/config'))!.payload
    );
    expect(onlineCfg.state_topic).toBe('cosmos/d1/online');
    expect(onlineCfg.payload_on).toBe('online');
    expect(onlineCfg.payload_off).toBe('offline');
  });

  it('returns retain=true for all discovery payloads', () => {
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }]);
    expect(out.every((p) => p.retain === true)).toBe(true);
  });
});
