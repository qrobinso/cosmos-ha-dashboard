import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createSettingsRepo } from '../src/store/settings.js';
import {
  getToken,
  regenerateToken,
  clearToken,
  isEnabled,
  setEnabled,
} from '../src/store/mcp-token.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return createSettingsRepo(db);
}

describe('mcp-token store', () => {
  let settings: ReturnType<typeof createSettingsRepo>;

  beforeEach(() => {
    settings = setup();
  });

  it('isEnabled defaults to false', () => {
    expect(isEnabled(settings)).toBe(false);
  });

  it('setEnabled(true) flips the flag and back', () => {
    setEnabled(settings, true);
    expect(isEnabled(settings)).toBe(true);
    setEnabled(settings, false);
    expect(isEnabled(settings)).toBe(false);
  });

  it('getToken returns null until regenerated', () => {
    expect(getToken(settings)).toBeNull();
  });

  it('regenerateToken produces a cosmos_mcp_-prefixed hex string and persists it', () => {
    const t1 = regenerateToken(settings);
    expect(t1).toMatch(/^cosmos_mcp_[0-9a-f]{64}$/);
    expect(getToken(settings)).toBe(t1);
  });

  it('regenerateToken called twice yields a different value', () => {
    const t1 = regenerateToken(settings);
    const t2 = regenerateToken(settings);
    expect(t1).not.toBe(t2);
    expect(getToken(settings)).toBe(t2);
  });

  it('clearToken removes the token but leaves the enabled flag', () => {
    regenerateToken(settings);
    setEnabled(settings, true);
    clearToken(settings);
    expect(getToken(settings)).toBeNull();
    expect(isEnabled(settings)).toBe(true);
  });
});
