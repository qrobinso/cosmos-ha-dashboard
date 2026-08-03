import { describe, it, expect, afterEach } from 'vitest';
import { tick } from 'svelte';
import MusicVideo from './MusicVideo.svelte';
import type { WidgetState } from '$lib/types';

function widget(config: Record<string, unknown> = {}, videoId: string | null = 'abc123') {
  return {
    id: 'w1',
    kind: 'musicvideo',
    position: { col: 1, row: 1, w: 2, h: 2 },
    config,
    data: { entity_id: 'media_player.x', video_id: videoId, state: 'playing' },
  } as unknown as WidgetState;
}

let host: HTMLDivElement | null = null;
let component: MusicVideo | null = null;

function video() {
  return host?.querySelector('video') as HTMLVideoElement | null;
}

/**
 * jsdom has no media pipeline, so `canplay` never fires on its own — but the
 * component deliberately stays transparent until it does, so a fade-in never
 * reveals a blank or stuttering element.
 */
async function ready() {
  video()?.dispatchEvent(new Event('canplay'));
  await tick();
}

async function mount(w: WidgetState, { settle = true } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = new MusicVideo({ target: host, props: { widget: w } });
  await tick();
  if (settle) await ready();
  return video();
}

/** Swap the widget prop and let the component react. */
async function retrack(w: WidgetState) {
  component!.$set({ widget: w });
  await tick();
}

afterEach(() => {
  component?.$destroy();
  component = null;
  host?.remove();
  host = null;
});

describe('MusicVideo — opacity', () => {
  it('is fully opaque by default', async () => {
    expect((await mount(widget()))!.style.opacity).toBe('1');
  });

  it('applies a configured opacity', async () => {
    expect((await mount(widget({ opacity: 0.35 })))!.style.opacity).toBe('0.35');
  });

  it('clamps out-of-range values instead of emitting invalid CSS', async () => {
    expect((await mount(widget({ opacity: 4 })))!.style.opacity).toBe('1');
  });

  it('ignores a non-numeric opacity', async () => {
    expect((await mount(widget({ opacity: 'half' })))!.style.opacity).toBe('1');
  });
});

describe('MusicVideo — edge fade', () => {
  it('emits no mask at all by default, so the common case costs nothing', async () => {
    const el = (await mount(widget()))!;
    expect(el.classList.contains('faded')).toBe(false);
    expect(el.style.getPropertyValue('--mv-fade')).toBe('');
  });

  it('applies a mask with the configured distance', async () => {
    const el = (await mount(widget({ edge_fade: 100 })))!;
    expect(el.classList.contains('faded')).toBe(true);
    expect(el.style.getPropertyValue('--mv-fade')).toBe('100px');
  });

  it('treats 0 and negatives as off', async () => {
    expect((await mount(widget({ edge_fade: 0 })))!.classList.contains('faded')).toBe(false);
    expect((await mount(widget({ edge_fade: -20 })))!.classList.contains('faded')).toBe(false);
  });

  it('caps an absurd fade rather than masking the video out of existence', async () => {
    const el = (await mount(widget({ edge_fade: 100000 })))!;
    expect(el.style.getPropertyValue('--mv-fade')).toBe('400px');
  });

  it('ignores a non-numeric fade', async () => {
    expect((await mount(widget({ edge_fade: 'lots' })))!.classList.contains('faded')).toBe(false);
  });
});

describe('MusicVideo — track-change crossfade', () => {
  it('starts transparent and fades in only once the video can actually play', async () => {
    const el = (await mount(widget(), { settle: false }))!;
    // Fading in earlier would flash a blank rectangle on the wall.
    expect(el.style.opacity).toBe('0');
    await ready();
    expect(video()!.style.opacity).toBe('1');
  });

  it('carries the configured fade duration as a CSS transition', async () => {
    const el = (await mount(widget({ fade_ms: 1200 })))!;
    expect(el.style.transition).toContain('1200ms');
  });

  it('defaults to an 800ms fade', async () => {
    expect((await mount(widget()))!.style.transition).toContain('800ms');
  });

  it('fades the old video out BEFORE swapping the source', async () => {
    const el = (await mount(widget({ fade_ms: 40 }, 'first')))!;
    expect(el.style.opacity).toBe('1');
    expect(el.getAttribute('src')).toContain('first');

    await retrack(widget({ fade_ms: 40 }, 'second'));

    // Still the OLD source, now fading out — not a hard cut.
    expect(video()!.style.opacity).toBe('0');
    expect(video()!.getAttribute('src')).toContain('first');

    await new Promise((r) => setTimeout(r, 70));
    await tick();

    // Source swapped, and still transparent until the new one is ready.
    expect(video()!.getAttribute('src')).toContain('second');
    expect(video()!.style.opacity).toBe('0');

    await ready();
    expect(video()!.style.opacity).toBe('1');
  });

  it('fades out and stays gone when the next track has no video', async () => {
    await mount(widget({ fade_ms: 40 }, 'first'));
    await retrack(widget({ fade_ms: 40 }, null));
    expect(video()!.style.opacity).toBe('0');

    await new Promise((r) => setTimeout(r, 70));
    await tick();
    expect(video()).toBeNull();
  });

  it('skips the fade-out when nothing is on screen yet', async () => {
    await mount(widget({ fade_ms: 5000 }, null), { settle: false });
    expect(video()).toBeNull();

    await retrack(widget({ fade_ms: 5000 }, 'first'));
    // No 5s wait for a fade-out that has nothing to fade.
    expect(video()!.getAttribute('src')).toContain('first');
  });

  it('fades in to the configured opacity, not to full', async () => {
    expect((await mount(widget({ opacity: 0.4 })))!.style.opacity).toBe('0.4');
  });

  it('hides the element when the video fails to load', async () => {
    const el = (await mount(widget()))!;
    expect(el.style.opacity).toBe('1');
    el.dispatchEvent(new Event('error'));
    await tick();
    expect(video()).toBeNull();
  });
});

describe('MusicVideo — element', () => {
  it('renders nothing when there is no video', async () => {
    expect(await mount(widget({}, null))).toBeNull();
  });

  it('is always muted, looping and inline — audio belongs to the HA speaker', async () => {
    const el = (await mount(widget()))!;
    expect(el.muted).toBe(true);
    expect(el.loop).toBe(true);
    expect(el.hasAttribute('playsinline')).toBe(true);
  });

  it('opts out of PiP, remote playback and AirPlay', async () => {
    const el = (await mount(widget()))!;
    expect(el.hasAttribute('disablepictureinpicture')).toBe(true);
    expect(el.hasAttribute('disableremoteplayback')).toBe(true);
    expect(el.getAttribute('x-webkit-airplay')).toBe('deny');
  });

  it('points at the proxy, never a googlevideo url', async () => {
    expect((await mount(widget()))!.getAttribute('src')).toBe('/api/musicvideo/stream/abc123');
  });
});
