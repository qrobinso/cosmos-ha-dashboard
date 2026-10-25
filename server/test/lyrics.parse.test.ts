import { describe, it, expect } from 'vitest';
import { parseLrc, parsePlain, markChorus } from '../src/lyrics/parse.js';

describe('parseLrc', () => {
  it('reads mm:ss.xx, mm:ss and mm:ss.xxx stamps', () => {
    expect(parseLrc('[00:12.34]a\n[01:02]b\n[00:01.234]c')).toEqual([
      { t: 1.234, text: 'c' },
      { t: 12.34, text: 'a' },
      { t: 62, text: 'b' },
    ]);
  });

  it('expands multiple stamps on one line', () => {
    expect(parseLrc('[00:05.00][00:30.00]x')).toEqual([
      { t: 5, text: 'x' },
      { t: 30, text: 'x' },
    ]);
  });

  it('ignores metadata tags and drops empty gap markers', () => {
    expect(parseLrc('[ar:Foo]\n[ti:Bar]\n[00:01.00]hi\n[00:09.00]\n[00:12.00]  ')).toEqual([
      { t: 1, text: 'hi' },
    ]);
  });

  it('returns nothing for metadata-only text', () => {
    expect(parseLrc('[ar:Foo]\n[length:03:20]')).toEqual([]);
  });

  it('applies the offset tag (positive = earlier)', () => {
    expect(parseLrc('[offset:500]\n[00:02.00]x')).toEqual([{ t: 1.5, text: 'x' }]);
  });

  it('strips enhanced word tags', () => {
    expect(parseLrc('[00:01.00]<00:01.00>We <00:01.50>were')).toEqual([{ t: 1, text: 'We were' }]);
  });
});

describe('parsePlain', () => {
  it('keeps non-blank lines without timestamps', () => {
    expect(parsePlain('one\n\n two \n')).toEqual([{ text: 'one' }, { text: 'two' }]);
  });
});

describe('markChorus', () => {
  it('flags lines that repeat, ignoring case and punctuation', () => {
    const out = markChorus([{ text: 'We were gold!' }, { text: 'Under the moon' }, { text: 'we were  gold' }]);
    expect(out.map((l) => !!l.chorus)).toEqual([true, false, true]);
  });
});
