import { describe, it, expect, vi } from 'vitest';
import { buildSceneState } from '../src/scenes/assembler.js';
import type { Scene } from '../src/store/scenes.js';
import type { EntityState } from '../src/scenes/types.js';
import type { MusicVideoData } from '../src/scenes/types.js';

const SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 };

function scene(config: Record<string, unknown>): Scene {
  return {
    id: 'scene-1',
    name: 'Test',
    background: { type: 'solid', color: '#000' },
    widgets: [
      {
        id: 'w1',
        kind: 'musicvideo',
        position: { x: 0, y: 0, w: 4, h: 3 },
        config,
      },
    ],
  } as unknown as Scene;
}

function playingEntity(over: Partial<EntityState['attributes']> = {}): EntityState {
  return {
    entity_id: 'media_player.living_room',
    state: 'playing',
    attributes: {
      media_artist: 'David Bowie',
      media_title: 'Heroes',
      media_position: 42,
      media_position_updated_at: '2026-08-02T10:00:00+00:00',
      media_duration: 214,
      ...over,
    },
  } as unknown as EntityState;
}

describe('assembler — musicvideo widget', () => {
  it('passes artist and title to the resolver and surfaces the videoId', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: 'abc123' }));
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      {
        resolveEntity: () => playingEntity(),
        musicVideoResolver,
      },
    );

    expect(musicVideoResolver).toHaveBeenCalledWith('w1', {
      artist: 'David Bowie',
      title: 'Heroes',
      querySuffix: undefined,
      durationSec: 214,
    });

    const data = state.widgets[0].data as MusicVideoData;
    expect(data.video_id).toBe('abc123');
    expect(data.entity_id).toBe('media_player.living_room');
    expect(data.state).toBe('playing');
    expect(data.position).toBe(42);
    expect(data.duration).toBe(214);
    expect(data.position_updated_at).toBe('2026-08-02T10:00:00+00:00');
  });

  it("surfaces HA's media_position_updated_at so the kiosk can anchor drift math", async () => {
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      {
        resolveEntity: () =>
          playingEntity({ media_position_updated_at: '2026-08-02T11:22:33.500+00:00' }),
        musicVideoResolver: () => ({ videoId: 'abc123' }),
      },
    );
    expect((state.widgets[0].data as MusicVideoData).position_updated_at)
      .toBe('2026-08-02T11:22:33.500+00:00');
  });

  it('omits position_updated_at when HA does not report one', async () => {
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      {
        resolveEntity: () => playingEntity({ media_position_updated_at: undefined }),
        musicVideoResolver: () => ({ videoId: 'abc123' }),
      },
    );
    expect((state.widgets[0].data as MusicVideoData).position_updated_at).toBeUndefined();
  });

  it('carries position_updated_at even on the not-playing path', async () => {
    const paused = { ...playingEntity(), state: 'idle' } as EntityState;
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      { resolveEntity: () => paused, musicVideoResolver: () => ({ videoId: null }) },
    );
    expect((state.widgets[0].data as MusicVideoData).position_updated_at)
      .toBe('2026-08-02T10:00:00+00:00');
  });

  it('forwards a configured query_suffix', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: null }));
    await buildSceneState(
      scene({ entity_id: 'media_player.living_room', query_suffix: 'live 1977' }),
      SAFE_AREA,
      { resolveEntity: () => playingEntity(), musicVideoResolver },
    );
    expect(musicVideoResolver).toHaveBeenCalledWith('w1', {
      artist: 'David Bowie',
      title: 'Heroes',
      querySuffix: 'live 1977',
      durationSec: 214,
    });
  });

  it('passes durationSec through from media_duration', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: null }));
    await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      {
        resolveEntity: () => playingEntity({ media_duration: 195 }),
        musicVideoResolver,
      },
    );
    expect(musicVideoResolver).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ durationSec: 195 }),
    );
  });

  it('passes durationSec: undefined when HA does not report media_duration', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: null }));
    await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      {
        resolveEntity: () => playingEntity({ media_duration: undefined }),
        musicVideoResolver,
      },
    );
    expect(musicVideoResolver).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ durationSec: undefined }),
    );
  });

  it('yields a null video_id while the lookup is still pending', async () => {
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      { resolveEntity: () => playingEntity(), musicVideoResolver: () => ({ videoId: null }) },
    );
    expect((state.widgets[0].data as MusicVideoData).video_id).toBeNull();
  });

  it('does not call the resolver when the player is not playing', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: 'abc123' }));
    const idle = { ...playingEntity(), state: 'idle' } as EntityState;
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      { resolveEntity: () => idle, musicVideoResolver },
    );
    expect(musicVideoResolver).not.toHaveBeenCalled();
    expect((state.widgets[0].data as MusicVideoData).video_id).toBeNull();
  });

  it('does not look up a video for a TV episode', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: 'abc123' }));
    const tvEntity = playingEntity({
      media_content_type: 'tvshow',
      media_artist: 'Love Island USA',
      media_title: 'S8 \u00b7 E19: Episode 19',
    });
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      { resolveEntity: () => tvEntity, musicVideoResolver },
    );
    expect(musicVideoResolver).not.toHaveBeenCalled();
    expect((state.widgets[0].data as MusicVideoData).video_id).toBeNull();
  });

  it('still looks up when the player reports no content type', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: 'abc123' }));
    await buildSceneState(scene({ entity_id: 'media_player.living_room' }), SAFE_AREA, {
      resolveEntity: () => playingEntity(),
      musicVideoResolver,
    });
    // Many integrations omit media_content_type entirely; a denylist must not
    // turn that into a silent no-op.
    expect(musicVideoResolver).toHaveBeenCalled();
  });

  it('looks up when the content type is music', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: 'abc123' }));
    await buildSceneState(scene({ entity_id: 'media_player.living_room' }), SAFE_AREA, {
      resolveEntity: () => playingEntity({ media_content_type: 'music' }),
      musicVideoResolver,
    });
    expect(musicVideoResolver).toHaveBeenCalled();
  });

  it('degrades to a null video_id when no resolver is wired', async () => {
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      { resolveEntity: () => playingEntity() },
    );
    const data = state.widgets[0].data as MusicVideoData;
    expect(data.video_id).toBeNull();
    expect(data.entity_id).toBe('media_player.living_room');
  });

  it('handles a missing entity_id without throwing', async () => {
    const state = await buildSceneState(scene({}), SAFE_AREA, {
      musicVideoResolver: () => ({ videoId: null }),
    });
    expect((state.widgets[0].data as MusicVideoData).video_id).toBeNull();
  });
});
