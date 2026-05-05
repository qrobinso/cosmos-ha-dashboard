import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanMoodsDir } from '../src/moods/scan.js';

describe('scanMoodsDir', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cosmos-moods-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty list for null or missing directory', () => {
    expect(scanMoodsDir(null)).toEqual([]);
    expect(scanMoodsDir(join(dir, 'nope'))).toEqual([]);
  });

  it('lists only .mp4 files', () => {
    writeFileSync(join(dir, 'clouds.mp4'), '');
    writeFileSync(join(dir, 'README.md'), '');
    writeFileSync(join(dir, 'rain.MP4'), '');
    const ids = scanMoodsDir(dir).map((m) => m.id).sort();
    expect(ids).toEqual(['clouds', 'rain']);
  });

  it('uses catalog metadata when an id matches', () => {
    writeFileSync(join(dir, 'clouds.mp4'), '');
    const [entry] = scanMoodsDir(dir);
    expect(entry.id).toBe('clouds');
    expect(entry.label).toBe('Drifting clouds');
    expect(entry.tags.length).toBeGreaterThan(0);
  });

  it('humanizes labels for unknown ids', () => {
    writeFileSync(join(dir, 'aurora-borealis.mp4'), '');
    const [entry] = scanMoodsDir(dir);
    expect(entry.id).toBe('aurora-borealis');
    expect(entry.label).toBe('Aurora Borealis');
    expect(entry.tags).toEqual([]);
  });
});
