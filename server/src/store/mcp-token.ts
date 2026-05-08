import { randomBytes } from 'node:crypto';
import type { SettingsRepo } from './settings.js';

const KEY_TOKEN = 'mcp_token';
const KEY_ENABLED = 'mcp_enabled';

/** Returns the current MCP bearer token, or null when none is set. */
export function getToken(settings: SettingsRepo): string | null {
  const v = settings.get(KEY_TOKEN);
  return v && v.length > 0 ? v : null;
}

/** Generates a fresh token and persists it. Returns the new value so the
 *  caller can echo it back to the user once. The old token is gone. */
export function regenerateToken(settings: SettingsRepo): string {
  const hex = randomBytes(32).toString('hex');
  const token = `cosmos_mcp_${hex}`;
  settings.set(KEY_TOKEN, token);
  return token;
}

/** Wipes the token. Used by the explicit Clear action; not by the toggle. */
export function clearToken(settings: SettingsRepo): void {
  settings.set(KEY_TOKEN, '');
}

/** Whether the user has flipped the MCP toggle on. Independent of token. */
export function isEnabled(settings: SettingsRepo): boolean {
  return settings.get(KEY_ENABLED) === 'true';
}

/** Set or clear the enabled flag. */
export function setEnabled(settings: SettingsRepo, enabled: boolean): void {
  settings.set(KEY_ENABLED, enabled ? 'true' : '');
}
