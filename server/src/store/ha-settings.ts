import type { SettingsRepo } from './settings.js';

export const HA_URL_KEY = 'ha_url';
export const HA_TOKEN_KEY = 'ha_token';

export type StoredHaConfig = {
  url: string | null;
  token: string | null;
};

export type EffectiveHaConfig = {
  url: string | null;
  token: string | null;
  source: 'environment' | 'manual' | 'supervisor' | 'mock';
};

export type HaRuntimeInfo = {
  source: EffectiveHaConfig['source'];
  activeUrl: string | null;
  connected: boolean;
  envConfigured: boolean;
  supervisorAvailable: boolean;
};

export type HaSettingsPayload = {
  url: string | null;
  hasToken: boolean;
  runtime: HaRuntimeInfo;
};

export function normalizeHaUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Home Assistant URL must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Home Assistant URL must start with http:// or https://');
  }
  return trimmed.replace(/\/+$/, '');
}

export function readStoredHaConfig(settings: SettingsRepo): StoredHaConfig {
  const rawUrl = settings.get(HA_URL_KEY)?.trim() ?? '';
  const rawToken = settings.get(HA_TOKEN_KEY)?.trim() ?? '';
  return {
    url: rawUrl || null,
    token: rawToken || null,
  };
}

export function writeStoredHaConfig(
  settings: SettingsRepo,
  patch: { url?: string; token?: string }
): StoredHaConfig {
  if (patch.url !== undefined) {
    settings.set(HA_URL_KEY, normalizeHaUrl(patch.url));
  }
  if (patch.token !== undefined) {
    settings.set(HA_TOKEN_KEY, patch.token.trim());
  }
  return readStoredHaConfig(settings);
}

export function resolveEffectiveHaConfig(input: {
  settings: SettingsRepo;
  envUrl: string | null;
  envToken: string | null;
  supervisorToken: string | null;
  supervisorUrl: string;
}): EffectiveHaConfig {
  if (input.envUrl && input.envToken) {
    return { url: input.envUrl, token: input.envToken, source: 'environment' };
  }

  const stored = readStoredHaConfig(input.settings);
  if (stored.url && stored.token) {
    return { url: stored.url, token: stored.token, source: 'manual' };
  }

  if (input.supervisorToken) {
    return { url: input.supervisorUrl, token: input.supervisorToken, source: 'supervisor' };
  }

  return { url: null, token: null, source: 'mock' };
}

export function readHaSettingsPayload(
  settings: SettingsRepo,
  runtime: HaRuntimeInfo
): HaSettingsPayload {
  const stored = readStoredHaConfig(settings);
  return {
    url: stored.url,
    hasToken: !!stored.token,
    runtime,
  };
}
