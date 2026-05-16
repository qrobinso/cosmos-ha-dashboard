import { describe, it, expect } from 'vitest';
import { buildDiscoveryPayloads, COSMOS_DEVICE_ID } from '../src/mqtt/discovery.js';

describe('buildDiscoveryPayloads', () => {
  it('emits 6 entities per display (sensor, binary_sensor, notify, 2 buttons, select)', () => {
    const out = buildDiscoveryPayloads(
      [
        { id: 'd1', name: 'Living Room' },
        { id: 'd2', name: 'Kitchen' },
      ],
      ['Morning', 'Evening']
    );

    expect(out.length).toBe(16); // 2 displays * 8 entities

    expect(out.filter((p) => p.topic.includes('/sensor/')).length).toBe(2);
    expect(out.filter((p) => p.topic.includes('/binary_sensor/')).length).toBe(2);
    // show_message + show_alert = 2 notifies per display
    expect(out.filter((p) => p.topic.includes('/notify/')).length).toBe(4);
    // dismiss_message + last_scene = 2 buttons per display
    expect(out.filter((p) => p.topic.includes('/button/')).length).toBe(4);
    // active_scene + alert_scene = 2 selects per display
    expect(out.filter((p) => p.topic.includes('/select/')).length).toBe(4);
    // No number entities: the alert dwell now travels in the notify's title field.
    expect(out.filter((p) => p.topic.includes('/number/')).length).toBe(0);

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

  it('emits a notify entity wired to the message/set command topic', () => {
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }]);
    const cfg = JSON.parse(
      out.find((p) => p.topic.endsWith('cosmos_d1_show_message/config'))!.payload
    );
    expect(cfg.command_topic).toBe('cosmos/d1/message/set');
    expect(cfg.command_template).toContain('title');
    expect(cfg.command_template).toContain('value');
  });

  it('emits a button entity for dismissing messages', () => {
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }]);
    const cfg = JSON.parse(
      out.find((p) => p.topic.endsWith('cosmos_d1_dismiss_message/config'))!.payload
    );
    expect(cfg.command_topic).toBe('cosmos/d1/message/dismiss');
    expect(cfg.payload_press).toBe('');
  });

  it('emits a select entity for picking the alert scene (dropdown)', () => {
    const out = buildDiscoveryPayloads(
      [{ id: 'd1', name: 'A' }],
      ['Morning', 'Evening']
    );
    const select = JSON.parse(
      out.find((p) => p.topic.endsWith('cosmos_d1_alert_scene/config'))!.payload
    );
    expect(select.command_topic).toBe('cosmos/d1/alert/scene/set');
    expect(select.state_topic).toBe('cosmos/d1/alert/scene');
    expect(select.options).toEqual(['Morning', 'Evening']);
  });

  it('no longer emits the removed alert dwell number or fire button', () => {
    // Dwell rides in the notify's title field; the notify is the fire path.
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }], ['Morning']);
    expect(out.find((p) => p.topic.endsWith('cosmos_d1_alert_dwell/config'))).toBeUndefined();
    expect(out.find((p) => p.topic.endsWith('cosmos_d1_alert_fire/config'))).toBeUndefined();
  });

  it('emits a single notify entity that carries both scene + dwell', () => {
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }]);
    const cfg = JSON.parse(
      out.find((p) => p.topic.endsWith('cosmos_d1_show_alert/config'))!.payload
    );
    expect(cfg.command_topic).toBe('cosmos/d1/scene/alert');
    // Message field → scene name; Title field → dwell seconds (default 5).
    expect(cfg.command_template).toContain('scene_name');
    expect(cfg.command_template).toContain('dwell_ms');
    expect(cfg.command_template).toContain('value');
    expect(cfg.command_template).toContain('title');
    expect(cfg.name).toBe('A Show Alert');
  });

  it('emits a button entity for switching back to the last-used scene', () => {
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }]);
    const cfg = JSON.parse(
      out.find((p) => p.topic.endsWith('cosmos_d1_last_scene/config'))!.payload
    );
    expect(cfg.command_topic).toBe('cosmos/d1/scene/last');
    expect(cfg.payload_press).toBe('');
    expect(cfg.name).toBe('A Last Scene');
  });

  it('emits a select entity populated with the current scene names', () => {
    const out = buildDiscoveryPayloads(
      [{ id: 'd1', name: 'A' }],
      ['Morning', 'Evening', 'Night']
    );
    const cfg = JSON.parse(
      out.find((p) => p.topic.endsWith('cosmos_d1_active_scene/config'))!.payload
    );
    expect(cfg.command_topic).toBe('cosmos/d1/scene/set');
    expect(cfg.options).toEqual(['Morning', 'Evening', 'Night']);
    expect(cfg.state_topic).toBe('cosmos/d1/current_scene');
  });

  it('select options default to empty array when no scenes provided', () => {
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }]);
    const cfg = JSON.parse(
      out.find((p) => p.topic.endsWith('cosmos_d1_active_scene/config'))!.payload
    );
    expect(cfg.options).toEqual([]);
  });

  it('returns retain=true for all discovery payloads', () => {
    const out = buildDiscoveryPayloads([{ id: 'd1', name: 'A' }]);
    expect(out.every((p) => p.retain === true)).toBe(true);
  });
});
