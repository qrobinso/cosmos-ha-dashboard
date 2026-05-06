import { describe, it, expect } from 'vitest';
import { parseCommandTopic } from '../src/mqtt/commands.js';
import { createFakeMqttClient } from '../src/mqtt/fakeClient.js';

describe('parseCommandTopic', () => {
  it('parses message/set with title-only payload', () => {
    const cmd = parseCommandTopic('cosmos/Living%20Room/message/set', '{"title":"Hello"}');
    expect(cmd).toEqual({
      kind: 'show_message',
      target: 'Living%20Room',
      message: { title: 'Hello', body: undefined, icon: undefined, timeout_ms: undefined },
    });
  });

  it('parses message/set with full payload', () => {
    const cmd = parseCommandTopic('cosmos/Kitchen/message/set', '{"title":"X","body":"Y","icon":"🔔","timeout_ms":4000}');
    expect(cmd?.kind).toBe('show_message');
    if (cmd?.kind === 'show_message') {
      expect(cmd.message).toEqual({ title: 'X', body: 'Y', icon: '🔔', timeout_ms: 4000 });
    }
  });

  it('rejects message/set without title', () => {
    expect(parseCommandTopic('cosmos/Hall/message/set', '{}')).toBeNull();
    expect(parseCommandTopic('cosmos/Hall/message/set', '{"title":""}')).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseCommandTopic('cosmos/Hall/message/set', 'not json')).toBeNull();
  });

  it('parses message/dismiss with empty payload', () => {
    expect(parseCommandTopic('cosmos/Hall/message/dismiss', '')).toEqual({
      kind: 'dismiss_message',
      target: 'Hall',
    });
  });

  it('parses scene/set with scene_name', () => {
    expect(parseCommandTopic('cosmos/Hall/scene/set', '{"scene_name":"Morning"}')).toEqual({
      kind: 'show_scene',
      target: 'Hall',
      sceneName: 'Morning',
    });
  });

  it('parses scene/last as a last-scene command (no payload)', () => {
    expect(parseCommandTopic('cosmos/Hall/scene/last', '')).toEqual({
      kind: 'last_scene',
      target: 'Hall',
    });
  });

  it('parses scene/alert with scene_name + dwell_ms', () => {
    expect(
      parseCommandTopic('cosmos/Kitchen/scene/alert', '{"scene_name":"Doorbell","dwell_ms":15000}')
    ).toEqual({
      kind: 'show_scene_alert',
      target: 'Kitchen',
      sceneName: 'Doorbell',
      dwellMs: 15000,
      transitionId: undefined,
    });
  });

  it('parses scene/alert with optional transition_id', () => {
    const cmd = parseCommandTopic(
      'cosmos/Kitchen/scene/alert',
      '{"scene_name":"Doorbell","dwell_ms":5000,"transition_id":"cross-fade"}'
    );
    expect(cmd?.kind).toBe('show_scene_alert');
    if (cmd?.kind === 'show_scene_alert') expect(cmd.transitionId).toBe('cross-fade');
  });

  it('rejects scene/alert without scene_name or with non-numeric dwell_ms', () => {
    expect(parseCommandTopic('cosmos/X/scene/alert', '{"dwell_ms":1000}')).toBeNull();
    expect(parseCommandTopic('cosmos/X/scene/alert', '{"scene_name":"A"}')).toBeNull();
    expect(parseCommandTopic('cosmos/X/scene/alert', '{"scene_name":"A","dwell_ms":"oops"}')).toBeNull();
  });

  it('returns null for unrelated topics', () => {
    expect(parseCommandTopic('homeassistant/sensor/whatever', '{}')).toBeNull();
  });

  it('parses alert/scene/set as a plain string scene name', () => {
    const cmd = parseCommandTopic('cosmos/Living/alert/scene/set', 'Doorbell');
    expect(cmd).toEqual({ kind: 'set_alert_scene', target: 'Living', sceneName: 'Doorbell' });
  });

  it('rejects empty alert/scene/set payload', () => {
    expect(parseCommandTopic('cosmos/Living/alert/scene/set', '   ')).toBeNull();
  });

  it('parses alert/dwell/set as a positive number of seconds', () => {
    const cmd = parseCommandTopic('cosmos/Living/alert/dwell/set', '8');
    expect(cmd).toEqual({ kind: 'set_alert_dwell', target: 'Living', dwellSec: 8 });
  });

  it('rejects non-numeric or non-positive alert/dwell/set payloads', () => {
    expect(parseCommandTopic('cosmos/Living/alert/dwell/set', 'forever')).toBeNull();
    expect(parseCommandTopic('cosmos/Living/alert/dwell/set', '0')).toBeNull();
    expect(parseCommandTopic('cosmos/Living/alert/dwell/set', '-3')).toBeNull();
  });

  it('parses alert/fire as a no-payload trigger', () => {
    expect(parseCommandTopic('cosmos/Living/alert/fire', '')).toEqual({
      kind: 'fire_alert',
      target: 'Living',
    });
  });

  it('treats target=all as broadcast', () => {
    const cmd = parseCommandTopic('cosmos/all/message/set', '{"title":"Hi"}');
    expect(cmd?.target).toBe('all');
  });
});

describe('fake MQTT client', () => {
  it('inject delivers a payload to handlers whose topic matches via wildcards', () => {
    const m = createFakeMqttClient();
    let received: { topic: string; payload: string } | null = null;
    m.subscribe('cosmos/+/message/set', (t, p) => (received = { topic: t, payload: p }));
    m.inject('cosmos/Living/message/set', '{"title":"hi"}');
    expect(received).toEqual({ topic: 'cosmos/Living/message/set', payload: '{"title":"hi"}' });
  });

  it('publish records messages with retain flag', () => {
    const m = createFakeMqttClient();
    m.publish('homeassistant/sensor/x/config', { name: 'X' }, { retain: true });
    m.publish('cosmos/Living/scene', 'Morning');
    expect(m.published).toEqual([
      { topic: 'homeassistant/sensor/x/config', payload: '{"name":"X"}', retain: true },
      { topic: 'cosmos/Living/scene', payload: 'Morning', retain: false },
    ]);
  });
});
