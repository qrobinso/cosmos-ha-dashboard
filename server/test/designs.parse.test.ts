import { describe, it, expect } from 'vitest';
import { parseDesignPack, previewFromFrontmatter } from '../src/designs/parse.js';

describe('parseDesignPack', () => {
  it('splits a well-formed file into frontmatter and body', () => {
    const raw = [
      '---',
      'name: Quiet Luxury',
      'colors:',
      '  bg: "#0d0c0a"',
      '  accent: "#c8b896"',
      '---',
      '',
      '# Quiet Luxury',
      '',
      'Calm, warm, minimal.',
    ].join('\n');
    const r = parseDesignPack(raw);
    expect(r.frontmatter).toEqual({
      name: 'Quiet Luxury',
      colors: { bg: '#0d0c0a', accent: '#c8b896' },
    });
    expect(r.body.trim().startsWith('# Quiet Luxury')).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('treats a file with no frontmatter as body-only', () => {
    const raw = '# Just a title\n\nBody text only.';
    const r = parseDesignPack(raw);
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe(raw);
    expect(r.errors).toEqual([]);
  });

  it('returns an error for malformed YAML and treats body as the rest', () => {
    const raw = '---\ncolors: {bg: "#0d0c0a"\n---\n\nBody after broken yaml.';
    const r = parseDesignPack(raw);
    expect(r.frontmatter).toEqual({});
    expect(r.body.trim()).toBe('Body after broken yaml.');
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/yaml/i);
  });

  it('handles a file with only frontmatter and no body', () => {
    const raw = '---\nname: Skeleton\n---\n';
    const r = parseDesignPack(raw);
    expect(r.frontmatter).toEqual({ name: 'Skeleton' });
    expect(r.body).toBe('');
    expect(r.errors).toEqual([]);
  });

  it('exposes the four-color preview helper', () => {
    const fm = {
      colors: { bg: '#0d0c0a', surface: '#3b342c', accent: '#c8b896', text: '#f3ecd8', extra: '#ffffff' },
      typography: { body: { fontFamily: 'Inter' } },
    };
    expect(previewFromFrontmatter(fm)).toEqual({
      colors: ['#0d0c0a', '#3b342c', '#c8b896', '#f3ecd8'],
      font_family: 'Inter',
    });
  });

  it('returns an empty frontmatter (no error) for an empty --- --- block', () => {
    const raw = '---\n---\n\nBody.';
    const r = parseDesignPack(raw);
    expect(r.frontmatter).toEqual({});
    expect(r.body.trim()).toBe('Body.');
    expect(r.errors).toEqual([]);
  });
});

describe('previewFromFrontmatter', () => {
  it('rejects 5-digit and 7-digit hex strings (invalid CSS lengths)', () => {
    const fm = {
      colors: { a: '#12345', b: '#1234567', c: '#123456', d: '#1234' },
    };
    // 5-digit '#12345' and 7-digit '#1234567' should be skipped; 6-digit '#123456' and 4-digit '#1234' kept.
    expect(previewFromFrontmatter(fm).colors).toEqual(['#123456', '#1234']);
  });

  it('returns empty colors when colors is an array, not an object', () => {
    const fm = { colors: ['#000', '#fff'] };
    expect(previewFromFrontmatter(fm).colors).toEqual([]);
  });

  it('returns empty colors when colors object has no hex values', () => {
    const fm = { colors: { bg: 'red', text: 'rebeccapurple' } };
    expect(previewFromFrontmatter(fm).colors).toEqual([]);
  });

  it('returns null font_family when typography.body.fontFamily missing', () => {
    expect(previewFromFrontmatter({}).font_family).toBeNull();
    expect(previewFromFrontmatter({ typography: {} }).font_family).toBeNull();
    expect(previewFromFrontmatter({ typography: { body: {} } }).font_family).toBeNull();
  });
});
