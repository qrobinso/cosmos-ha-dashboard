import { describe, it, expect } from 'vitest';
import { parseDesignPack } from '../src/designs/parse.js';

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

  it('exposes the four-color preview helper', async () => {
    const { previewFromFrontmatter } = await import('../src/designs/parse.js');
    const fm = {
      colors: { bg: '#0d0c0a', surface: '#3b342c', accent: '#c8b896', text: '#f3ecd8', extra: '#ffffff' },
      typography: { body: { fontFamily: 'Inter' } },
    };
    expect(previewFromFrontmatter(fm)).toEqual({
      colors: ['#0d0c0a', '#3b342c', '#c8b896', '#f3ecd8'],
      font_family: 'Inter',
    });
  });
});
