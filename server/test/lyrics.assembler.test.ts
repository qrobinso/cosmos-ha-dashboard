import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildSceneState } from '../src/scenes/assembler.js';
import type { Scene } from '../src/store/scenes.js';
import type { EntityState, LyricsData } from '../src/scenes/types.js';

const SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 };
const NOW = Date.parse('2026-10-25T10:00:10Z');

function scene(config: Record<string, unknown> = { entity_id: 'media_player.lr' }): Scene {
  return {
    id: 's1',
    name: 'Test',
    background: { type: 'solid', color: '#000' },
    widgets: [{ id: 'w1', kind: 'lyrics', position: { col: 1, row: 1, w: 4, h: 3 }, config }],
  } as unknown as Scene;
}

function entity(state = 'playing', over: Record<string, unknown> = {}): EntityState {
  return {
    entity_id: 'media_player.lr',
    state,
    attributes: {
      media_artist: 'David Bowie',
      media_title: 'Heroes',
      media_position: 42,
      media_position_updated_at: '2026-10-25T10:00:00Z',
      media_duration: 371,
      ...over,
    },
  } as unknown as EntityState;
}

const lines = [{ t: 1, text: 'we can be heroes' }];

async function assemble(e: EntityState | null, lyricsResolver?: ReturnType<typeof vi.fn>) {
  const state = await buildSceneState(scene(), SAFE_AREA, {
    resolveEntity: async () => e,
    lyricsResolver: lyricsResolver as never,
  });
  return state.widgets[0].data as LyricsData;
}

afterEach(() => vi.useRealTimers());

describe('assembler — lyrics widget', () => {
  it('extrapolates a playing position to push time and surfaces resolved lines', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const resolver = vi.fn(() => ({ lines, synced: true, trackKey: 'david bowie|heroes' }));
    const data = await assemble(entity(), resolver);
    expect(resolver).toHaveBeenCalledWith('w1', { artist: 'David Bowie', title: 'Heroes', durationSec: 371 });
    expect(data).toMatchObject({ entity_id: 'media_player.lr', state: 'playing', lines, synced: true, track_key: 'david bowie|heroes', duration: 371 });
    expect(data.position).toBeCloseTo(52, 3);
  });

  it('does not advance a paused position', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const data = await assemble(entity('paused'), vi.fn(() => ({ lines, synced: true, trackKey: 'k' })));
    expect(data.position).toBe(42);
  });

  it('clamps the extrapolated position to the track duration', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const data = await assemble(entity('playing', { media_position: 370 }), vi.fn(() => ({ lines, synced: true, trackKey: 'k' })));
    expect(data.position).toBe(371);
  });

  it('hides non-music content without calling the resolver', async () => {
    const resolver = vi.fn();
    const data = await assemble(entity('playing', { media_content_type: 'tvshow' }), resolver);
    expect(data.lines).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('hides when the player is idle or no resolver is wired', async () => {
    expect((await assemble(entity('idle'), vi.fn())).lines).toBeNull();
    expect((await assemble(entity())).lines).toBeNull();
    expect((await assemble(null, vi.fn())).lines).toBeNull();
  });
});
