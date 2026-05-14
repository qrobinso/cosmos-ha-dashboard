import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { resolveEffectiveHaConfig, writeStoredHaConfig } from '../src/store/ha-settings.js';

function freshRepo() {
  const db = new Database(':memory:');
  runMigrations(db);
  return createSettingsRepo(db);
}

describe('settings repo', () => {
  let repo: ReturnType<typeof createSettingsRepo>;

  beforeEach(() => {
    repo = freshRepo();
  });

  it('get returns null when key is unset', () => {
    expect(repo.get('foo')).toBeNull();
  });

  it('set then get returns the stored value', () => {
    repo.set('greeting', 'hello');
    expect(repo.get('greeting')).toBe('hello');
  });

  it('set overwrites existing values', () => {
    repo.set('greeting', 'hi');
    repo.set('greeting', 'hey');
    expect(repo.get('greeting')).toBe('hey');
  });

  it('resolves stored Home Assistant settings before Supervisor fallback', () => {
    writeStoredHaConfig(repo, {
      url: 'http://homeassistant.local:8123/',
      token: 'manual-token',
    });
    expect(resolveEffectiveHaConfig({
      settings: repo,
      envUrl: null,
      envToken: null,
      supervisorToken: 'supervisor-token',
      supervisorUrl: 'http://supervisor/core',
    })).toEqual({
      url: 'http://homeassistant.local:8123',
      token: 'manual-token',
      source: 'manual',
    });
  });

  it('keeps environment Home Assistant settings highest priority', () => {
    writeStoredHaConfig(repo, {
      url: 'http://homeassistant.local:8123',
      token: 'manual-token',
    });
    expect(resolveEffectiveHaConfig({
      settings: repo,
      envUrl: 'http://env-ha:8123',
      envToken: 'env-token',
      supervisorToken: 'supervisor-token',
      supervisorUrl: 'http://supervisor/core',
    })).toEqual({
      url: 'http://env-ha:8123',
      token: 'env-token',
      source: 'environment',
    });
  });
});
