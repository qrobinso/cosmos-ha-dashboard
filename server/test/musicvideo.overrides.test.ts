import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createMusicVideoOverrideRepo } from '../src/musicvideo/overrides.js';
import type { DB } from '../src/store/db.js';

function freshDb(): DB {
  const db = new Database(':memory:') as unknown as DB;
  runMigrations(db);
  return db;
}

describe('music video override repo', () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it('returns null for an unknown track', () => {
    const repo = createMusicVideoOverrideRepo(db);
    expect(repo.get('solange|weary')).toBeNull();
  });

  it('round-trips a pin', () => {
    const repo = createMusicVideoOverrideRepo(db, { now: () => 1000 });
    repo.put({ trackKey: 'solange|weary', videoId: 'abc12345678', artist: 'Solange', title: 'Weary' });
    expect(repo.get('solange|weary')).toEqual({
      trackKey: 'solange|weary',
      videoId: 'abc12345678',
      artist: 'Solange',
      title: 'Weary',
      createdAt: 1000,
    });
  });

  it('round-trips a block as a present row with a null videoId', () => {
    const repo = createMusicVideoOverrideRepo(db, { now: () => 1000 });
    repo.put({ trackKey: 'solange|weary', videoId: null, artist: 'Solange', title: 'Weary' });
    const got = repo.get('solange|weary');
    // Distinguishable from "no row" — that is the whole point of blocking.
    expect(got).not.toBeNull();
    expect(got!.videoId).toBeNull();
  });

  it('upserts on the same track key rather than erroring', () => {
    const repo = createMusicVideoOverrideRepo(db, { now: () => 1000 });
    repo.put({ trackKey: 'a|b', videoId: 'one11111111', artist: 'A', title: 'B' });
    repo.put({ trackKey: 'a|b', videoId: 'two22222222', artist: 'A', title: 'B' });
    expect(repo.get('a|b')!.videoId).toBe('two22222222');
    expect(repo.list()).toHaveLength(1);
  });

  it('lists newest first', () => {
    let t = 0;
    const repo = createMusicVideoOverrideRepo(db, { now: () => t });
    t = 100;
    repo.put({ trackKey: 'old|one', videoId: 'aaa11111111', artist: 'Old', title: 'One' });
    t = 200;
    repo.put({ trackKey: 'new|two', videoId: 'bbb22222222', artist: 'New', title: 'Two' });
    expect(repo.list().map((o) => o.trackKey)).toEqual(['new|two', 'old|one']);
  });

  it('removes, reporting whether a row went', () => {
    const repo = createMusicVideoOverrideRepo(db);
    repo.put({ trackKey: 'a|b', videoId: 'one11111111', artist: 'A', title: 'B' });
    expect(repo.remove('a|b')).toBe(true);
    expect(repo.get('a|b')).toBeNull();
    expect(repo.remove('a|b')).toBe(false);
  });

  it('migration v12 adds artist/title display columns to the cache table', () => {
    const cols = (db.prepare('PRAGMA table_info(music_video_cache)').all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).toContain('artist');
    expect(cols).toContain('title');
  });
});
