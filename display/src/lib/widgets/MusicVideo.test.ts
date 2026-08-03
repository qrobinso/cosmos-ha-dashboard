import { describe, it, expect, afterEach } from 'vitest';
import MusicVideo from './MusicVideo.svelte';
import type { WidgetState } from '$lib/types';

function widget(config: Record<string, unknown> = {}, videoId: string | null = 'abc123') {
  return {
    id: 'w1',
    kind: 'musicvideo',
    position: { col: 1, row: 1, w: 2, h: 2 },
    config,
    data: videoId === null ? null : { entity_id: 'media_player.x', video_id: videoId, state: 'playing' },
  } as unknown as WidgetState;
}

let host: HTMLDivElement | null = null;
function mount(w: WidgetState) {
  host = document.createElement('div');
  document.body.appendChild(host);
  new MusicVideo({ target: host, props: { widget: w } });
  return host.querySelector('video') as HTMLVideoElement | null;
}

afterEach(() => {
  host?.remove();
  host = null;
});

describe('MusicVideo — opacity', () => {
  it('is fully opaque by default', () => {
    expect(mount(widget())!.style.opacity).toBe('1');
  });

  it('applies a configured opacity', () => {
    expect(mount(widget({ opacity: 0.35 }))!.style.opacity).toBe('0.35');
  });

  it('clamps out-of-range values instead of emitting invalid CSS', () => {
    expect(mount(widget({ opacity: 4 }))!.style.opacity).toBe('1');
    expect(mount(widget({ opacity: -2 }))!.style.opacity).toBe('0');
  });

  it('ignores a non-numeric opacity', () => {
    expect(mount(widget({ opacity: 'half' }))!.style.opacity).toBe('1');
  });

  it('allows fully transparent without hiding the element', () => {
    const el = mount(widget({ opacity: 0 }))!;
    expect(el).not.toBeNull();
    expect(el.style.opacity).toBe('0');
  });
});

describe('MusicVideo — element', () => {
  it('renders nothing when there is no video', () => {
    expect(mount(widget({}, null))).toBeNull();
  });

  it('is always muted, looping and inline — audio belongs to the HA speaker', () => {
    const el = mount(widget())!;
    expect(el.muted).toBe(true);
    expect(el.loop).toBe(true);
    expect(el.hasAttribute('playsinline')).toBe(true);
  });

  it('opts out of PiP, remote playback and AirPlay', () => {
    const el = mount(widget())!;
    expect(el.hasAttribute('disablepictureinpicture')).toBe(true);
    expect(el.hasAttribute('disableremoteplayback')).toBe(true);
    expect(el.getAttribute('x-webkit-airplay')).toBe('deny');
  });

  it('points at the proxy, never a googlevideo url', () => {
    expect(mount(widget())!.getAttribute('src')).toBe('/api/musicvideo/stream/abc123');
  });
});
