/** One lyric line. `t` (seconds) is absent for plain, untimed lyrics. */
export type LyricsLine = { t?: number; text: string; chorus?: boolean };

const STAMP = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET = /^\[offset:\s*([+-]?\d+)\]/im;
const WORD_TAG = /<\d+:\d{1,2}(?:[.:]\d{1,3})?>/g;

/**
 * LRC text → time-sorted lines. Metadata tags (`[ar:]`, `[ti:]`…) never match
 * the numeric stamp pattern so they fall out naturally. Stamps with no text
 * mark instrumental gaps; the gap is implied by the next stamp, so they're dropped.
 */
export function parseLrc(lrc: string): LyricsLine[] {
  const offsetMatch = OFFSET.exec(lrc);
  // LRC convention: a positive offset shows lyrics sooner.
  const shift = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  const out: LyricsLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps: number[] = [];
    let rest = raw;
    STAMP.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STAMP.exec(raw)) !== null) {
      if (m.index !== raw.length - rest.length) break; // stamps only at line start
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + frac);
      rest = raw.slice(m.index + m[0].length);
    }
    if (stamps.length === 0) continue;
    const text = rest.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const s of stamps) out.push({ t: Math.max(0, round(s - shift)), text });
  }
  return out.sort((a, b) => a.t! - b.t!);
}

export function parsePlain(text: string): LyricsLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ text }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

/** A line whose normalized text appears more than once is treated as chorus. */
export function markChorus(lines: LyricsLine[]): LyricsLine[] {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(norm(l.text), (counts.get(norm(l.text)) ?? 0) + 1);
  return lines.map((l) => ((counts.get(norm(l.text)) ?? 0) > 1 ? { ...l, chorus: true } : l));
}

const round = (n: number) => Math.round(n * 1000) / 1000;
