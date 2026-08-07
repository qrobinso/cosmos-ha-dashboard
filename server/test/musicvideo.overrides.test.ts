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

  it('applies cleanly over a v11 database that already has cache rows', () => {
    // Simulate an existing install: build a v11 DB, put a row in, then migrate.
    const legacy = new Database(':memory:') as unknown as DB;
    legacy.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    legacy.exec(`CREATE TABLE music_video_cache (
      track_key TEXT PRIMARY KEY, video_id TEXT, miss INTEGER NOT NULL DEFAULT 0, resolved_at INTEGER NOT NULL);`);
    legacy.prepare('INSERT INTO music_video_cache (track_key, video_id, miss, resolved_at) VALUES (?,?,?,?)')
      .run('legacy|track', 'zzz99999999', 0, 5);
    for (let v = 1; v <= 11; v++) legacy.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v);

    runMigrations(legacy);

    const row = legacy.prepare('SELECT * FROM music_video_cache WHERE track_key = ?').get('legacy|track') as Record<string, unknown>;
    expect(row.video_id).toBe('zzz99999999');
    // Pre-v12 rows have no display names; the History list falls back to the key.
    expect(row.artist).toBeNull();
    expect(row.title).toBeNull();
  });
});
