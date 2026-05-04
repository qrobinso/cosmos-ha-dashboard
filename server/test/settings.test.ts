import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createSettingsRepo } from '../src/store/settings.js';

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
});
