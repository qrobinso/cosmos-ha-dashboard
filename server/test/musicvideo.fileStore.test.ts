import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type DB } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createVideoFileStore } from '../src/musicvideo/fileStore.js';

let dir: string;
let db: DB;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cosmos-vid-'));
  db = openDatabase(':memory:');
  runMigrations(db);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function store(now = () => 1000) {
  return createVideoFileStore(db, { dir, now });
}

/** Put a real file of `bytes` length on disk and register it. */
function put(s: ReturnType<typeof store>, videoId: string, bytes: number) {
  writeFileSync(s.pathFor(videoId), Buffer.alloc(bytes));
  s.record(videoId, bytes);
}

describe('video file store', () => {
  it('reports nothing stored for an unknown video', () => {
    const s = store();
    expect(s.has('abc12345678')).toBe(false);
    expect(s.totalBytes()).toBe(0);
  });

  it('records a downloaded file and counts its bytes', () => {
    const s = store();
    put(s, 'abc12345678', 5000);
    expect(s.has('abc12345678')).toBe(true);
    expect(s.totalBytes()).toBe(5000);
    expect(s.stats()).toEqual({ fileCount: 1, totalBytes: 5000 });
  });

  it('reports a video as absent when the row exists but the file is gone', () => {
    const s = store();
    put(s, 'abc12345678', 5000);
    rmSync(s.pathFor('abc12345678'));
    // Disk is the source of truth — a stale row must not make us serve a 404
    // from a path that no longer exists.
    expect(s.has('abc12345678')).toBe(false);
  });

  it('keeps the filename confined to the cache directory', () => {
    const s = store();
    // videoIds reach this from a URL param; a traversal must not escape.
    expect(s.pathFor('../../etc/passwd')).toBe(null);
    expect(s.pathFor('ok_video-1')).toContain(dir);
  });

  it('counts plays', () => {
    const s = store();
    put(s, 'abc12345678', 100);
    s.recordPlay('abc12345678');
    s.recordPlay('abc12345678');
    expect(s.stats().fileCount).toBe(1);
    expect(s.playCount('abc12345678')).toBe(2);
  });

  it('tolerates a play for a video with no local file', () => {
    const s = store();
    expect(() => s.recordPlay('nothinghere')).not.toThrow();
  });
});

describe('eviction', () => {
  it('does nothing while under the cap', () => {
    const s = store();
    put(s, 'aaa11111111', 1000);
    expect(s.evict(5000)).toEqual([]);
    expect(s.has('aaa11111111')).toBe(true);
  });

  it('evicts the least-played video first', () => {
    const s = store();
    put(s, 'popular0001', 1000);
    put(s, 'ignored0001', 1000);
    for (let i = 0; i < 5; i++) s.recordPlay('popular0001');

    expect(s.evict(1000)).toEqual(['ignored0001']);
    expect(s.has('popular0001')).toBe(true);
    expect(s.has('ignored0001')).toBe(false);
  });

  it('breaks ties on play count by evicting the oldest first', () => {
    let t = 0;
    const s = createVideoFileStore(db, { dir, now: () => t });
    t = 100; writeFileSync(s.pathFor('older111111')!, Buffer.alloc(1000)); s.record('older111111', 1000);
    t = 200; writeFileSync(s.pathFor('newer111111')!, Buffer.alloc(1000)); s.record('newer111111', 1000);
    // Same play count (0) — age decides.
    expect(s.evict(1000)).toEqual(['older111111']);
    expect(s.has('newer111111')).toBe(true);
  });

  it('uses last played, not download time, to age a played video', () => {
    let t = 0;
    const s = createVideoFileStore(db, { dir, now: () => t });
    t = 100; writeFileSync(s.pathFor('old_played1')!, Buffer.alloc(1000)); s.record('old_played1', 1000);
    t = 110; writeFileSync(s.pathFor('new_played1')!, Buffer.alloc(1000)); s.record('new_played1', 1000);
    // Both played once, but the older download was played most recently.
    t = 300; s.recordPlay('old_played1');
    t = 200; s.recordPlay('new_played1');

    expect(s.evict(1000)).toEqual(['new_played1']);
  });

  it('keeps evicting until it is under the cap, not just one file', () => {
    const s = store();
    put(s, 'aaa11111111', 1000);
    put(s, 'bbb22222222', 1000);
    put(s, 'ccc33333333', 1000);
    for (let i = 0; i < 9; i++) s.recordPlay('ccc33333333');

    const removed = s.evict(1000);
    expect(removed).toHaveLength(2);
    expect(s.totalBytes()).toBe(1000);
    expect(s.has('ccc33333333')).toBe(true);
  });

  it('deletes the actual file, not just the row', () => {
    const s = store();
    put(s, 'aaa11111111', 1000);
    const path = s.pathFor('aaa11111111')!;
    s.evict(0);
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a cap of zero clears everything — the user turning downloads off', () => {
    const s = store();
    put(s, 'aaa11111111', 1000);
    put(s, 'bbb22222222', 1000);
    expect(s.evict(0)).toHaveLength(2);
    expect(s.totalBytes()).toBe(0);
  });

  it('removes a single video on request', () => {
    const s = store();
    put(s, 'aaa11111111', 1000);
    const path = s.pathFor('aaa11111111')!;
    s.remove('aaa11111111');
    expect(existsSync(path)).toBe(false);
    expect(s.has('aaa11111111')).toBe(false);
  });
});
