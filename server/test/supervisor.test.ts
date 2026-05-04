import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMqttFromSupervisor, type SupervisorMqttResult } from '../src/ha/supervisor.js';

const fetchSpy = vi.spyOn(global, 'fetch');

afterEach(() => {
  fetchSpy.mockReset();
});

describe('fetchMqttFromSupervisor', () => {
  it('returns connection details when Supervisor reports an MQTT service', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { host: 'core-mosquitto', port: 1883, username: 'addon', password: 'pw', ssl: false } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const result = await fetchMqttFromSupervisor('http://supervisor', 'tok');
    expect(result).toEqual<SupervisorMqttResult>({
      url: 'mqtt://addon:pw@core-mosquitto:1883',
    });
  });

  it('omits credentials when no username is configured', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { host: 'broker', port: 1883, ssl: false } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const result = await fetchMqttFromSupervisor('http://supervisor', 'tok');
    expect(result).toEqual({ url: 'mqtt://broker:1883' });
  });

  it('uses mqtts:// when Supervisor reports ssl=true', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { host: 'broker', port: 8883, ssl: true } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const result = await fetchMqttFromSupervisor('http://supervisor', 'tok');
    expect(result).toEqual({ url: 'mqtts://broker:8883' });
  });

  it('returns null when Supervisor responds 400 (no MQTT service)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('no mqtt', { status: 400 }));
    const result = await fetchMqttFromSupervisor('http://supervisor', 'tok');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('boom'));
    const result = await fetchMqttFromSupervisor('http://supervisor', 'tok');
    expect(result).toBeNull();
  });

  it('passes Bearer token in the Authorization header', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { host: 'b', port: 1883, ssl: false } }),
        { status: 200 }
      )
    );
    await fetchMqttFromSupervisor('http://supervisor', 'tok');
    const req = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((req.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});
