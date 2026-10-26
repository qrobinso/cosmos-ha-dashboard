import { describe, it, expect, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import Lyrics from './Lyrics.svelte';
import { posterRecipe } from './lyrics/poster';
import type { WidgetState } from '$lib/types';

const LINES = [
  { t: 1, text: 'we can be heroes', chorus: true },
  { t: 10, text: 'just for one day' },
];

function widget(config: Record<string, unknown>, lines: unknown = LINES, position = 2) {
  return {
    id: 'w1',
    kind: 'lyrics',
    position: { col: 1, row: 1, w: 4, h: 3 },
    config,
    data: { entity_id: 'media_player.x', state: 'paused', lines, synced: true, position, duration: 200 },
  } as unknown as WidgetState;
}

let host: HTMLDivElement | null = null;
let component: Lyrics | null = null;

async function mount(w: WidgetState) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = new Lyrics({ target: host, props: { widget: w } });
  await tick();
  return host;
}

afterEach(() => {
  component?.$destroy();
  host?.remove();
  component = null;
  host = null;
});

describe('Lyrics widget', () => {
  it('renders nothing when there are no lyrics', async () => {
    const el = await mount(widget({}, null));
    expect(el.textContent?.trim()).toBe('');
  });

  for (const style of ['spotlight', 'karaoke', 'poster', 'drift']) {
    it(`${style}: shows the line being sung`, async () => {
      const el = await mount(widget({ style }));
      expect(el.querySelector(`[data-style="${style}"]`)).not.toBeNull();
      expect(el.querySelector('[data-current]')?.textContent?.replace(/\s+/g, ' ')).toContain('we can be heroes');
    });
  }

  it('applies the sync offset (positive = lyrics earlier)', async () => {
    const el = await mount(widget({ style: 'karaoke', offset_ms: 9000 }));
    expect(el.querySelector('[data-current]')?.textContent).toContain('just for one day');
  });

  it('falls back to spotlight for an unknown style', async () => {
    const el = await mount(widget({ style: 'nope' }));
    expect(el.querySelector('[data-style="spotlight"]')).not.toBeNull();
  });
});

describe('posterRecipe', () => {
  it('is deterministic and keeps every word', () => {
    const text = 'I keep your name inside my coat';
    expect(posterRecipe(text)).toEqual(posterRecipe(text));
    expect(posterRecipe(text).map((p) => p.text).join(' ')).toBe(text);
  });

  it('makes a single word big', () => {
    expect(posterRecipe('gold')).toEqual([{ text: 'gold', cls: 'big' }]);
  });
});

describe('Lyrics widget — review fixes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const ABC = [
    { t: 0, text: 'aaa' },
    { t: 2, text: 'bbb' },
    { t: 4, text: 'ccc' },
  ];

  function playing(lines: unknown, position: number | undefined, config: Record<string, unknown> = { style: 'karaoke' }, synced = true) {
    return {
      id: 'w1', kind: 'lyrics', position: { col: 1, row: 1, w: 4, h: 3 }, config,
      data: { entity_id: 'media_player.x', state: 'playing', lines, synced, position, duration: 200 },
    } as unknown as WidgetState;
  }

  it('keeps time across a parent re-render that passes the same data', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'performance'] });
    const w = playing(ABC, 0);
    const el = await mount(w);
    vi.advanceTimersByTime(3000);
    component!.$set({ widget: { ...w } }); // same data object, new widget wrapper
    vi.advanceTimersByTime(100);
    await tick();
    expect(el.querySelector('[data-current]')?.textContent).toContain('bbb');
  });

  it('hides when the player reports no position', async () => {
    const el = await mount(playing(ABC, undefined));
    expect(el.textContent?.trim()).toBe('');
  });

  it('karaoke shows plain lyrics at full strength', async () => {
    const el = await mount(playing([{ text: 'aaa' }, { text: 'bbb' }], 0, { style: 'karaoke' }, false));
    expect(el.querySelector('.line.plain [data-current], .line.plain')).not.toBeNull();
  });

  it('drift floats up to three lines at once, each placed explicitly', async () => {
    const el = await mount(playing([...ABC, { t: 6, text: 'ddd' }], 6.5, { style: 'drift' }));
    const shown = [...el.querySelectorAll<HTMLElement>('[data-style="drift"] .line')];
    expect(shown.map((l) => l.textContent?.trim())).toEqual(['bbb', 'ccc', 'ddd']);
    for (const l of shown) expect(l.parentElement!.style.top).toMatch(/px$/);
  });
});

describe('Lyrics widget — font moods', () => {
  const families = (el: Element, sel: string) =>
    [...el.querySelectorAll<HTMLElement>(sel)].map((n) => n.style.fontFamily);

  it('spotlight and karaoke take the mood main font', async () => {
    const el = await mount(widget({ style: 'karaoke', font_mood: 'gig' }));
    const root = el.querySelector<HTMLElement>('.lyrics')!;
    expect(root.style.getPropertyValue('--lyr-font')).toContain('Bebas Neue');
  });

  it('poster mixes faces from the mood', async () => {
    const el = await mount(widget({ style: 'poster', font_mood: 'editorial' }));
    const fams = families(el, '[data-current] span');
    expect(fams.length).toBeGreaterThan(0);
    for (const f of fams) expect(f).toMatch(/Playfair Display|Cormorant Garamond|Inter/);
  });

  it('drift gives each line a face from the mood', async () => {
    const el = await mount(widget({ style: 'drift', font_mood: 'handwritten' }));
    for (const f of families(el, '[data-style="drift"] .line')) expect(f).toMatch(/Caveat|Permanent Marker/);
  });

  it('the scene font adds no per-part faces', async () => {
    const el = await mount(widget({ style: 'poster' }));
    for (const f of families(el, '[data-current] span')) expect(f).toBe('');
  });
});

describe('Lyrics widget — custom font and opacity', () => {
  it('uses a custom Google font as the main face and loads it', async () => {
    const el = await mount(widget({ style: 'spotlight', custom_font: 'Lobster' }));
    expect(el.querySelector<HTMLElement>('.lyrics')!.style.getPropertyValue('--lyr-font')).toContain('Lobster');
    expect(document.head.querySelector('link[data-cosmos-font="Lobster"]')).not.toBeNull();
  });

  it('without a mood, the custom font is used for every poster part', async () => {
    const el = await mount(widget({ style: 'poster', custom_font: 'Lobster' }));
    const fams = [...el.querySelectorAll<HTMLElement>('[data-current] span')].map((n) => n.style.fontFamily);
    expect(fams.length).toBeGreaterThan(0);
    for (const f of fams) expect(f).toContain('Lobster');
  });

  it('with a mood, the custom font joins the mix as the main face', async () => {
    const el = await mount(widget({ style: 'karaoke', font_mood: 'gig', custom_font: 'Lobster' }));
    expect(el.querySelector<HTMLElement>('.lyrics')!.style.getPropertyValue('--lyr-font')).toContain('Lobster');
  });

  it('applies widget opacity', async () => {
    const el = await mount(widget({ opacity: 0.4 }));
    expect(el.querySelector<HTMLElement>('.lyrics')!.style.opacity).toBe('0.4');
  });

  it('ignores an out-of-range opacity', async () => {
    const el = await mount(widget({ opacity: 7 }));
    expect(el.querySelector<HTMLElement>('.lyrics')!.style.opacity).toBe('');
  });
});

describe('Lyrics widget — text size', () => {
  const size = (el: Element) => el.querySelector<HTMLElement>('.lyrics')!.style.getPropertyValue('--lyr-size');

  it('maps normal / large / xl to 1 / 1.25 / 1.5', async () => {
    expect(size(await mount(widget({ text_size: 'large' })))).toBe('1.25');
    component!.$destroy(); host!.remove();
    expect(size(await mount(widget({ text_size: 'xl' })))).toBe('1.5');
  });

  it('defaults to normal for missing or unknown values', async () => {
    expect(size(await mount(widget({ text_size: 'huge' })))).toBe('1');
  });
});

describe('Lyrics widget — drift word reveal', () => {
  it('reveals words one at a time, paced across the sung part of the line', async () => {
    const el = await mount(widget({ style: 'drift' }));
    const words = [...el.querySelectorAll<HTMLElement>('[data-current] .word')];
    expect(words.map((w) => w.textContent)).toEqual(['we', 'can', 'be', 'heroes']);
    // Delay is `calc(<word delay>s + var(--late))`; the word's own offset is what's paced.
    const delays = words.map((w) => parseFloat(w.getAttribute('style')!.match(/calc\(([\d.]+)s/)![1]));
    expect(delays[0]).toBe(0);
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    // Line runs 1s → 10s; words finish well inside it, at a natural pace.
    expect(delays.at(-1)!).toBeLessThan(9 * 0.8);
  });
});

describe('Lyrics widget — drift timing', () => {
  it("a line lives until its lane is reused, starting partway in if joined late", async () => {
    // Lines at 0/2/4/6: line 0's lane is reused by line 3 at 6s.
    const lines = [{ t: 0, text: 'aaa' }, { t: 2, text: 'bbb' }, { t: 4, text: 'ccc' }, { t: 6, text: 'ddd' }];
    const el = await mount(widget({ style: 'drift' }, lines, 1));
    const line = el.querySelector<HTMLElement>('[data-current]')!;
    expect(line.style.getPropertyValue('--life')).toBe('5.75s');
    expect(line.style.getPropertyValue('--late')).toBe('-1s');
  });
});

describe('Lyrics widget — drift stability', () => {
  it('older lines keep their animation offset when a new line arrives (no jump)', async () => {
    const lines = [{ t: 0, text: 'aaa' }, { t: 2, text: 'bbb' }, { t: 4, text: 'ccc' }];
    const w = widget({ style: 'drift' }, lines, 2.5);
    const el = await mount(w);
    const lateOf = (text: string) =>
      [...el.querySelectorAll<HTMLElement>('.line')].find((l) => l.textContent?.includes(text))!.style.getPropertyValue('--late');
    const before = lateOf('aaa');
    component!.$set({ widget: { ...w, data: { ...(w.data as object), position: 4.5 } } as WidgetState });
    await tick();
    expect(lateOf('ccc')).toBeTruthy();
    expect(lateOf('aaa')).toBe(before);
  });
});
