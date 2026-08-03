import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  runMigrations(db);
  return db;
}

describe('displays repo', () => {
  let repo: ReturnType<typeof createDisplaysRepo>;

  beforeEach(() => {
    repo = createDisplaysRepo(freshDb());
  });

  it('registerByName creates a display the first time and returns it', () => {
    const d = repo.registerByName('Living Room');
    expect(d.name).toBe('Living Room');
    expect(d.id).toMatch(/^[a-z0-9-]{8,}$/);
  });

  it('registerByName is idempotent — same name returns the same id', () => {
    const a = repo.registerByName('Kitchen');
    const b = repo.registerByName('Kitchen');
    expect(b.id).toBe(a.id);
  });

  it('list returns all displays', () => {
    repo.registerByName('A');
    repo.registerByName('B');
    expect(repo.list().map((d) => d.name).sort()).toEqual(['A', 'B']);
  });

  it('touch updates last_seen', () => {
    const d = repo.registerByName('Hallway');
    repo.touch(d.id);
    const after = repo.list().find((x) => x.id === d.id)!;
    expect(after.lastSeen).not.toBeNull();
  });

  it('setDefaultScene stores the scene id and getById returns it', () => {
    const d = repo.registerByName('Office');
    repo.setDefaultScene(d.id, 'scene-abc');
    const fetched = repo.getById(d.id);
    expect(fetched?.defaultSceneId).toBe('scene-abc');
  });

  it('setCurrentScene stores the active scene id', () => {
    const d = repo.registerByName('Bedroom');
    repo.setCurrentScene(d.id, 'scene-xyz');
    const fetched = repo.getById(d.id);
    expect(fetched?.currentSceneId).toBe('scene-xyz');
  });

  it('defaults voiceEnabled to false and voicePipelineId to null', () => {
    const d = repo.registerByName('kitchen');
    expect(d.voiceEnabled).toBe(false);
    expect(d.voicePipelineId).toBeNull();
  });

  it('setVoice persists enabled flag and pipeline id', () => {
    const d = repo.registerByName('kitchen');
    repo.setVoice(d.id, { enabled: true, pipelineId: 'pipeline-123' });
    const updated = repo.getById(d.id);
    expect(updated?.voiceEnabled).toBe(true);
    expect(updated?.voicePipelineId).toBe('pipeline-123');
  });

  it('setVoice can clear the pipeline id back to null', () => {
    const d = repo.registerByName('kitchen');
    repo.setVoice(d.id, { enabled: true, pipelineId: 'pipeline-123' });
    repo.setVoice(d.id, { enabled: false, pipelineId: null });
    const updated = repo.getById(d.id);
    expect(updated?.voiceEnabled).toBe(false);
    expect(updated?.voicePipelineId).toBeNull();
  });
});
