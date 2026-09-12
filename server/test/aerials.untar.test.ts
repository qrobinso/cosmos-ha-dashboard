import { describe, it, expect } from 'vitest';
import { untarEntry, untarAll } from '../src/aerials/untar.js';

/** Build a plain ustar archive in memory — the same format Apple serves. */
function header(name: string, size: number, type = '0'): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148); // checksum placeholder
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

function tar(entries: Array<{ name: string; body?: Buffer; type?: string }>): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const body = e.body ?? Buffer.alloc(0);
    parts.push(header(e.name, body.length, e.type ?? '0'));
    parts.push(body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024)); // end-of-archive
  return Buffer.concat(parts);
}

describe('untar', () => {
  it('extracts a named entry, ignoring directories and other files', () => {
    const json = Buffer.from('{"version":1}');
    const buf = tar([
      { name: './', type: '5' },
      { name: './TVIdleScreenStrings.bundle/', type: '5' },
      { name: './cbbim-w-prod.mat', body: Buffer.alloc(700, 1) },
      { name: './entries.json', body: json },
    ]);
    expect(untarEntry(buf, 'entries.json')?.toString()).toBe('{"version":1}');
  });

  it('matches with or without a leading ./', () => {
    const buf = tar([{ name: 'entries.json', body: Buffer.from('x') }]);
    expect(untarEntry(buf, 'entries.json')?.toString()).toBe('x');
    expect(untarEntry(buf, './entries.json')?.toString()).toBe('x');
  });

  it('returns null when the entry is absent', () => {
    const buf = tar([{ name: 'other.txt', body: Buffer.from('x') }]);
    expect(untarEntry(buf, 'entries.json')).toBeNull();
  });

  it('handles bodies that are not a multiple of 512 bytes', () => {
    const a = Buffer.alloc(513, 7);
    const b = Buffer.from('after');
    const buf = tar([{ name: 'a.bin', body: a }, { name: 'b.txt', body: b }]);
    expect(untarEntry(buf, 'b.txt')?.toString()).toBe('after');
    expect(untarAll(buf).get('a.bin')?.length).toBe(513);
  });

  it('rejects a truncated archive rather than reading past the end', () => {
    const buf = tar([{ name: 'a.bin', body: Buffer.alloc(1000, 1) }]).subarray(0, 800);
    expect(() => untarAll(buf)).toThrow(/truncated/);
  });
});
