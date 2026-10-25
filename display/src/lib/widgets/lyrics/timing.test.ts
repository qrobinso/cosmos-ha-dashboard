import { describe, it, expect } from 'vitest';
import { livePosition, currentIndex, lineProgress, inGap, plainIndex } from './timing';

const lines = [
  { t: 10, text: 'one two three' },
  { t: 14, text: 'four five' },
  { t: 40, text: 'six' },
];

describe('livePosition', () => {
  it('advances by elapsed time while playing, plus the offset', () => {
    expect(livePosition(42, 1000, 3000, true, 500)).toBeCloseTo(44.5);
  });
  it('freezes while paused', () => {
    expect(livePosition(42, 1000, 9000, false, 0)).toBe(42);
  });
});

describe('currentIndex', () => {
  it('is -1 before the first line', () => expect(currentIndex(lines, 9.9)).toBe(-1));
  it('picks the last started line', () => expect(currentIndex(lines, 15)).toBe(1));
  it('follows a seek backwards', () => {
    expect(currentIndex(lines, 41)).toBe(2);
    expect(currentIndex(lines, 11)).toBe(0);
  });
});

describe('lineProgress', () => {
  it('runs 0..1 between this line and the next', () => {
    expect(lineProgress(lines, 0, 12)).toBeCloseTo(0.5);
  });
  it('ends the last line at the track duration', () => {
    expect(lineProgress(lines, 2, 45, 50)).toBeCloseTo(0.5);
  });
  it('gives the last line 5s when duration is unknown', () => {
    expect(lineProgress(lines, 2, 42.5)).toBeCloseTo(0.5);
  });
  it('is 0 before the first line', () => expect(lineProgress(lines, -1, 5)).toBe(0));
});

describe('inGap', () => {
  it('is true in a long intro', () => expect(inGap(lines, 3)).toBe(true));
  it('is false for a short intro', () => expect(inGap([{ t: 4, text: 'x' }], 1)).toBe(false));
  it('is false while a line is being sung', () => expect(inGap(lines, 15)).toBe(false));
  it('is true once a line has had its time and the next is far off', () => expect(inGap(lines, 25)).toBe(true));
  it('clears just before the next line', () => expect(inGap(lines, 39.5)).toBe(false));
});

describe('plainIndex', () => {
  it('paces lines evenly across the duration', () => {
    expect(plainIndex(10, 0, 100)).toBe(0);
    expect(plainIndex(10, 55, 100)).toBe(5);
    expect(plainIndex(10, 200, 100)).toBe(9);
  });
  it('falls back to 4s per line without a duration', () => {
    expect(plainIndex(10, 9)).toBe(2);
  });
});
