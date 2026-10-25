import type { LyricsLine } from '$lib/types';

/** A gap shorter than this (intro, or between lines) isn't worth a ♪ pulse. */
const GAP_S = 5;
/** Untimed lyrics with no known duration advance at this pace. */
const PLAIN_LINE_S = 4;

/**
 * Player position now. `pushed` was extrapolated by the server at push time,
 * `anchorMs` is when that push arrived on this kiosk's own clock — so no
 * wall-clock comparison with HA ever happens. Positive offset = lyrics earlier.
 */
export function livePosition(pushed: number, anchorMs: number, nowMs: number, playing: boolean, offsetMs: number): number {
  const elapsed = playing ? Math.max(0, (nowMs - anchorMs) / 1000) : 0;
  return pushed + elapsed + offsetMs / 1000;
}

/** Index of the line being sung at `pos`; -1 before the first line. */
export function currentIndex(lines: LyricsLine[], pos: number): number {
  let i = -1;
  for (let k = 0; k < lines.length; k++) {
    if ((lines[k].t ?? Infinity) <= pos) i = k;
    else break;
  }
  return i;
}

/** When line `i` ends: the next line's start, else track end, else +5s. */
export function lineEnd(lines: LyricsLine[], i: number, duration?: number): number {
  const start = lines[i].t ?? 0;
  return lines[i + 1]?.t ?? (duration && duration > start ? duration : start + GAP_S);
}

export function lineProgress(lines: LyricsLine[], i: number, pos: number, duration?: number): number {
  if (i < 0) return 0;
  const start = lines[i].t ?? 0;
  const span = lineEnd(lines, i, duration) - start;
  return span > 0 ? Math.min(1, Math.max(0, (pos - start) / span)) : 1;
}

/**
 * LRC has no line end times, so a long wait for the next line is read as an
 * instrumental break once the current line has had a word-count-based moment
 * to be sung. Clears a second before the next line so the pulse never covers it.
 */
export function inGap(lines: LyricsLine[], pos: number): boolean {
  const first = lines[0]?.t;
  if (first === undefined) return false;
  if (pos < first) return first > GAP_S && first - pos > 1;
  const i = currentIndex(lines, pos);
  const next = lines[i + 1]?.t;
  if (next === undefined || next - pos <= 1) return false;
  const sung = Math.min(6, Math.max(2.5, lines[i].text.split(/\s+/).length * 0.6));
  return next - (lines[i].t ?? 0) > sung + GAP_S && pos - (lines[i].t ?? 0) > sung;
}

/** Which untimed line to show: evenly paced across the track, clamped. */
export function plainIndex(count: number, pos: number, duration?: number): number {
  const per = duration && duration > 0 ? duration / count : PLAIN_LINE_S;
  return Math.min(count - 1, Math.max(0, Math.floor(pos / per)));
}
