export type PosterPart = { text: string; cls: 'big' | 'serif' | 'mono' | 'plain' };

/** Small stable string hash (FNV-1a) — layouts must be deterministic per line. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Typeset one lyric line as a poster. Keyed on the text alone so a repeated
 * line (the chorus) always comes back looking the same — that recurrence is
 * what makes the chorus land visually.
 */
export function posterRecipe(text: string): PosterPart[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [{ text, cls: 'big' }];
  const longest = words.reduce((a, w, i) => (w.length > words[a].length ? i : a), 0);
  const join = (ws: string[]) => ws.join(' ');
  switch (hash(text) % 4) {
    case 0: // stacked rows, the longest word blown up
      return words.map((w, i) => ({ text: w, cls: i === longest ? 'big' : 'plain' }));
    case 1: // heavy lead, serif italic tail
      return [{ text: join(words.slice(0, -1)), cls: 'plain' }, { text: words.at(-1)!, cls: 'serif' }];
    case 2: { // mono caps lead-in, giant remainder
      const cut = Math.min(2, words.length - 1);
      return [{ text: join(words.slice(0, cut)), cls: 'mono' }, { text: join(words.slice(cut)), cls: 'big' }];
    }
    default: { // serif first half, heavy second half
      const mid = Math.ceil(words.length / 2);
      return [{ text: join(words.slice(0, mid)), cls: 'serif' }, { text: join(words.slice(mid)), cls: 'big' }];
    }
  }
}
