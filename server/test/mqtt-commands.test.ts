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

  it('returns null for unrelated topics', () => {
    expect(parseCommandTopic('homeassistant/sensor/whatever', '{}')).toBeNull();
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
