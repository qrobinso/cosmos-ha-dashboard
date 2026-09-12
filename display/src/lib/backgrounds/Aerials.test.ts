import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { tick } from 'svelte';
import Aerials from './Aerials.svelte';
import type { AerialClip } from '$lib/types';

const clips: AerialClip[] = [
  { id: 'A', name: 'Alpha', url: '/api/aerials/stream/A' },
  { id: 'B', name: 'Bravo', url: '/api/aerials/stream/B' },
  { id: 'C', name: 'Charlie', url: '/api/aerials/stream/C' },
];

let host: HTMLDivElement | null = null;
let component: Aerials | null = null;

function videos(): HTMLVideoElement[] {
  return Array.from(host?.querySelectorAll('video') ?? []);
}
/** The <video> currently carrying a src, or the one that is visible. */
function withSrc(): HTMLVideoElement[] {
  return videos().filter((v) => v.getAttribute('src'));
}
function visible(): HTMLVideoElement | undefined {
  return videos().find((v) => v.style.opacity === '1');
}
async function canplay(v: HTMLVideoElement) {
  v.dispatchEvent(new Event('canplay'));
  await tick();
}

async function mount(props: Partial<{ clips: AerialClip[]; shuffle: boolean; intervalMin: number; fadeMs: number }> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = new Aerials({ target: host, props: { clips, shuffle: false, intervalMin: 30, fadeMs: 10, ...props } });
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no media pipeline; make play() a resolved promise so the
  // component's `void el.play()` never throws.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
});
afterEach(() => {
  component?.$destroy();
  component = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

describe('Aerials background', () => {
  it('loads the first clip hidden and reveals it on canplay', async () => {
    await mount();
    const [v] = withSrc();
    expect(v.getAttribute('src')).toBe('/api/aerials/stream/A');
    expect(v.style.opacity).toBe('0');
    await canplay(v);
    expect(visible()).toBe(v);
  });

  it('loops a clip while a timer interval is set, and does not loop when advancing on end', async () => {
    await mount({ intervalMin: 30 });
    expect(withSrc()[0].hasAttribute('loop')).toBe(true);
    component!.$destroy();
    await mount({ intervalMin: 0 });
    expect(withSrc()[0].hasAttribute('loop')).toBe(false);
  });

  it('crossfades to the next clip when the interval elapses', async () => {
    await mount({ intervalMin: 5 });
    const first = withSrc()[0];
    await canplay(first);

    vi.advanceTimersByTime(5 * 60_000);
    await tick();
    const incoming = withSrc().find((v) => v !== first)!;
    expect(incoming.getAttribute('src')).toBe('/api/aerials/stream/B');
    // Old stays visible until the new one can actually play.
    expect(visible()).toBe(first);

    await canplay(incoming);
    expect(visible()).toBe(incoming);
    expect(first.style.opacity).toBe('0');

    // After the fade the old element is released.
    vi.advanceTimersByTime(50);
    await tick();
    expect(first.getAttribute('src')).toBeNull();
  });

  it('advances on ended when the interval is "when the clip ends"', async () => {
    await mount({ intervalMin: 0 });
    const first = withSrc()[0];
    await canplay(first);
    first.dispatchEvent(new Event('ended'));
    await tick();
    expect(withSrc().map((v) => v.getAttribute('src'))).toContain('/api/aerials/stream/B');
  });

  it('skips a clip that fails to load', async () => {
    await mount({ intervalMin: 30 });
    const first = withSrc()[0];
    first.dispatchEvent(new Event('error'));
    await tick();
    expect(withSrc().map((v) => v.getAttribute('src'))).toContain('/api/aerials/stream/B');
  });

  it('gives up after every clip has failed rather than looping forever', async () => {
    await mount({ intervalMin: 30 });
    for (let i = 0; i < clips.length; i++) {
      const pending = withSrc().find((v) => v.style.opacity === '0') ?? withSrc()[0];
      pending.dispatchEvent(new Event('error'));
      await tick();
    }
    expect(withSrc()).toHaveLength(0);
  });

  it('keeps playing across a re-push that carries the same clip set', async () => {
    await mount();
    const first = withSrc()[0];
    await canplay(first);
    component!.$set({ clips: [clips[2], clips[0], clips[1]] });
    await tick();
    expect(withSrc()).toEqual([first]);
    expect(first.getAttribute('src')).toBe('/api/aerials/stream/A');
  });

  it('restarts the playlist when the clip set changes', async () => {
    await mount();
    await canplay(withSrc()[0]);
    component!.$set({ clips: [{ id: 'Z', name: 'Zulu', url: '/api/aerials/stream/Z' }] });
    await tick();
    expect(withSrc().map((v) => v.getAttribute('src'))).toContain('/api/aerials/stream/Z');
  });

  it('plays every clip once per pass when shuffled', async () => {
    await mount({ shuffle: true, intervalMin: 5 });
    const seen = new Set<string>();
    for (let i = 0; i < clips.length; i++) {
      const pending = withSrc().find((v) => v.style.opacity === '0')!;
      seen.add(pending.getAttribute('src')!);
      await canplay(pending);
      vi.advanceTimersByTime(5 * 60_000);
      await tick();
    }
    expect(seen).toEqual(new Set(clips.map((c) => c.url)));
  });

  it('a single clip just keeps looping when the timer fires', async () => {
    await mount({ clips: [clips[0]], intervalMin: 5 });
    const only = withSrc()[0];
    await canplay(only);
    vi.advanceTimersByTime(5 * 60_000);
    await tick();
    expect(withSrc()).toEqual([only]);
  });

  it('renders nothing playable with an empty list', async () => {
    await mount({ clips: [] });
    expect(withSrc()).toHaveLength(0);
  });
});
