import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  return { db, transitions: createTransitionsRepo(db), overrides: createOverridesRepo(db) };
}

describe('transitions repo', () => {
  it('list returns all 6 built-ins', () => {
    const ctx = setup();
    const all = ctx.transitions.list();
    expect(all.length).toBe(6);
    expect(all.map((t) => t.name).sort()).toEqual([
      'cross-fade', 'dissolve', 'gradient-morph', 'scale-fade', 'slide-down', 'slide-up',
    ]);
    for (const t of all) {
      expect(t.out.keyframes).toBeTruthy();
      expect(t.in.keyframes).toBeTruthy();
      expect(typeof t.bridge.background_morph).toBe('boolean');
    }
  });

  it('getById returns the descriptor or null', () => {
    const ctx = setup();
    const got = ctx.transitions.getById('builtin-cross-fade');
    expect(got?.name).toBe('cross-fade');
    expect(ctx.transitions.getById('not-real')).toBeNull();
  });

  it('getByName returns the descriptor or null', () => {
    const ctx = setup();
    expect(ctx.transitions.getByName('gradient-morph')?.id).toBe('builtin-gradient-morph');
    expect(ctx.transitions.getByName('not-real')).toBeNull();
  });
});

describe('scene_transition_overrides repo', () => {
  it('set + get round-trip', () => {
    const ctx = setup();
    // Create two scenes so the FKs are satisfied
    ctx.db
      .prepare(
        `INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`
      )
      .run('s1', 'A', '{}', '{}', '{}');
    ctx.db
      .prepare(
        `INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`
      )
      .run('s2', 'B', '{}', '{}', '{}');
    ctx.overrides.set('s1', 's2', 'builtin-dissolve');
    expect(ctx.overrides.get('s1', 's2')).toBe('builtin-dissolve');
    expect(ctx.overrides.get('s2', 's1')).toBeNull();
  });

  it('set is upsert (changing the override replaces it)', () => {
    const ctx = setup();
    ctx.db
      .prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`)
      .run('s1', 'A', '{}', '{}', '{}');
    ctx.db
      .prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`)
      .run('s2', 'B', '{}', '{}', '{}');
    ctx.overrides.set('s1', 's2', 'builtin-dissolve');
    ctx.overrides.set('s1', 's2', 'builtin-slide-up');
    expect(ctx.overrides.get('s1', 's2')).toBe('builtin-slide-up');
  });

  it('clear removes the override', () => {
    const ctx = setup();
    ctx.db
      .prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`)
      .run('s1', 'A', '{}', '{}', '{}');
    ctx.db
      .prepare(`INSERT INTO scenes (id, name, layout_json, background_json, typography_json) VALUES (?, ?, ?, ?, ?)`)
      .run('s2', 'B', '{}', '{}', '{}');
    ctx.overrides.set('s1', 's2', 'builtin-dissolve');
    ctx.overrides.clear('s1', 's2');
    expect(ctx.overrides.get('s1', 's2')).toBeNull();
  });
});
