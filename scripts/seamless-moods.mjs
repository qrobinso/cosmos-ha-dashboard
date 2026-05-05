#!/usr/bin/env node
// Re-encodes every mp4 in display/static/moods/ as a seamless loop:
// splits the clip in half, swaps the halves, and crossfades across
// the new boundary. The original loop seam ends up buried in the
// middle of the output, and start/end frames are now identical so
// the file's own loop is invisible.
//
// Usage: node scripts/seamless-moods.mjs [path/to/moods/folder]
//        npm run moods:seamless
//
// Originals are backed up next to the output as <name>.original.mp4.
// Re-running the script is idempotent — files already processed are
// skipped (we mark them with the moviewriting "comment" metadata tag).

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, renameSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(__dirname, '..', 'display', 'static', 'moods');
const STAMP = 'cosmos:seamless';

function probeDuration(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { encoding: 'utf8' }
  ).trim();
  const d = Number(out);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`bad duration for ${file}: ${out}`);
  return d;
}

function probeComment(file) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { encoding: 'utf8' }
    ).trim();
    return out;
  } catch {
    return '';
  }
}

function processFile(file) {
  const name = file.replace(/\.mp4$/i, '');
  const original = `${name}.original.mp4`;
  const tmp = `${name}.tmp.mp4`;

  if (probeComment(file).includes(STAMP)) {
    console.log(`  skip (already seamless): ${file}`);
    return;
  }

  const duration = probeDuration(file);
  if (duration < 2) {
    console.log(`  skip (too short, ${duration.toFixed(2)}s): ${file}`);
    return;
  }
  const fade = Math.min(1, duration * 0.1);
  const half = duration / 2;
  const offset = half - fade;

  const filter =
    `[0:v]split=2[a][b];` +
    `[a]trim=0:${half},setpts=PTS-STARTPTS[first];` +
    `[b]trim=${half}:${duration},setpts=PTS-STARTPTS[second];` +
    `[second][first]xfade=transition=fade:duration=${fade}:offset=${offset}[v]`;

  console.log(`  processing ${file} (${duration.toFixed(2)}s, fade ${fade.toFixed(2)}s)…`);
  const res = spawnSync(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-i', file,
      '-filter_complex', filter,
      '-map', '[v]',
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-metadata', `comment=${STAMP}`,
      tmp,
    ],
    { stdio: 'inherit' }
  );
  if (res.status !== 0) throw new Error(`ffmpeg failed for ${file}`);

  if (!existsSync(original)) renameSync(file, original);
  renameSync(tmp, file);
  console.log(`  ✓ ${file}  (backup: ${original})`);
}

function main() {
  const dir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_DIR;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`not a directory: ${dir}`);
    process.exit(1);
  }
  const files = readdirSync(dir)
    .filter((f) => /\.mp4$/i.test(f))
    .filter((f) => !/\.original\.mp4$/i.test(f))
    .filter((f) => !/\.seamless\.mp4$/i.test(f))
    .filter((f) => !/\.tmp\.mp4$/i.test(f))
    .map((f) => join(dir, f));

  if (files.length === 0) {
    console.log(`no .mp4 files in ${dir}`);
    return;
  }
  console.log(`Processing ${files.length} clip(s) in ${dir}`);
  for (const f of files) {
    try {
      processFile(f);
    } catch (err) {
      console.error(`  ✗ ${f}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main();
