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
  afterEach(() => vi.useRealTimers());

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

  it('drift keeps recent lines mounted until their dissolve has finished', async () => {
    const el = await mount(playing([...ABC, { t: 6, text: 'ddd' }], 6.5, { style: 'drift' }));
    expect(el.querySelectorAll('[data-style="drift"] span')).toHaveLength(4);
  });
});
