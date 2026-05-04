export type SupervisorMqttResult = {
  url: string;
};

type SupervisorMqttPayload = {
  data?: {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    ssl?: boolean;
  };
};

export async function fetchMqttFromSupervisor(
  supervisorBase: string,
  token: string
): Promise<SupervisorMqttResult | null> {
  try {
    const res = await fetch(`${supervisorBase}/services/mqtt`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SupervisorMqttPayload;
    const data = body.data;
    if (!data || typeof data.host !== 'string' || typeof data.port !== 'number') return null;
    const protocol = data.ssl ? 'mqtts' : 'mqtt';
    const auth =
      typeof data.username === 'string' && data.username.length > 0
        ? `${encodeURIComponent(data.username)}:${encodeURIComponent(data.password ?? '')}@`
        : '';
    return { url: `${protocol}://${auth}${data.host}:${data.port}` };
  } catch {
    return null;
  }
}

export const SUPERVISOR_BASE = 'http://supervisor';
export const SUPERVISOR_HA_URL = 'http://supervisor/core';
