import { describe, it, expect } from 'vitest';
import { normalizeTrackKey } from '../src/musicvideo/trackKey.js';

describe('normalizeTrackKey', () => {
  it('lowercases and joins artist and title with a pipe', () => {
    expect(normalizeTrackKey('David Bowie', 'Heroes')).toBe('david bowie|heroes');
  });

  it('collapses runs of whitespace', () => {
    expect(normalizeTrackKey('  David   Bowie ', ' Heroes  ')).toBe('david bowie|heroes');
  });

  it('strips a parenthesised feat. clause', () => {
    expect(normalizeTrackKey('Drake', 'Money In The Grave (feat. Rick Ross)'))
      .toBe('drake|money in the grave');
  });

  it('strips a bare feat. clause', () => {
    expect(normalizeTrackKey('Drake', 'Money In The Grave feat. Rick Ross'))
      .toBe('drake|money in the grave');
  });

  it('accepts ft. and featuring as spellings', () => {
    expect(normalizeTrackKey('A', 'Song ft. B')).toBe('a|song');
    expect(normalizeTrackKey('A', 'Song featuring B')).toBe('a|song');
  });

  it('strips a trailing remaster suffix', () => {
    expect(normalizeTrackKey('The Beatles', 'Come Together - Remastered 2009'))
      .toBe('the beatles|come together');
  });

  it('strips a parenthesised remaster suffix', () => {
    expect(normalizeTrackKey('The Beatles', 'Come Together (Remastered)'))
      .toBe('the beatles|come together');
  });

  it('strips version suffixes', () => {
    expect(normalizeTrackKey('A', 'Song - 2011 Remaster')).toBe('a|song');
    expect(normalizeTrackKey('A', 'Song (Deluxe Edition)')).toBe('a|song');
  });

  it('leaves an ordinary hyphenated title alone', () => {
    expect(normalizeTrackKey('Jay-Z', 'Song - Two')).toBe('jay-z|song - two');
  });

  it('returns null when either half is missing or blank', () => {
    expect(normalizeTrackKey(undefined, 'Heroes')).toBeNull();
    expect(normalizeTrackKey('Bowie', undefined)).toBeNull();
    expect(normalizeTrackKey('   ', 'Heroes')).toBeNull();
    expect(normalizeTrackKey('Bowie', '  ')).toBeNull();
  });

  it('returns null when stripping empties the title', () => {
    expect(normalizeTrackKey('Bowie', '(Remastered)')).toBeNull();
  });
});
