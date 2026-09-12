/**
 * Minimal ustar reader.
 *
 * Apple's aerial resource bundles are plain uncompressed tar archives, and
 * the only member Cosmos needs is `entries.json`. A 512-byte-header walk is
 * enough for that and keeps a dependency out of the image; anything fancier
 * (gzip, pax long names, sparse files) is deliberately unsupported and will
 * surface as "entry not found" rather than a wrong read.
 */

const BLOCK = 512;

function readString(buf: Buffer, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString('utf8');
}

function readOctal(buf: Buffer, offset: number, length: number): number {
  const s = readString(buf, offset, length).trim();
  return s === '' ? 0 : Number.parseInt(s, 8);
}

function normalize(name: string): string {
  return name.replace(/^\.\//, '');
}

/** Every regular-file member, keyed by path with any leading `./` removed. */
export function untarAll(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let pos = 0;
  while (pos + BLOCK <= buf.length) {
    const header = buf.subarray(pos, pos + BLOCK);
    // Two zero blocks mark the end; one is enough to stop safely.
    if (header.every((b) => b === 0)) break;

    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const type = readString(header, 156, 1);
    const prefix = readString(header, 345, 155);
    pos += BLOCK;

    if (pos + size > buf.length) {
      throw new Error(`tar: truncated archive (member ${name} claims ${size} bytes past end)`);
    }
    if (type === '0' || type === '' || type === '\0') {
      out.set(normalize(prefix ? `${prefix}/${name}` : name), buf.subarray(pos, pos + size));
    }
    pos += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

/** One member by path (with or without a leading `./`), or null. */
export function untarEntry(buf: Buffer, name: string): Buffer | null {
  return untarAll(buf).get(normalize(name)) ?? null;
}
