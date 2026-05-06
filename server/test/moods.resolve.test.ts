import { describe, it, expect } from 'vitest';
import { resolveMood, timeOfDay } from '../src/moods/resolve.js';
import type { MoodConfig } from '../src/moods/types.js';
import type { EntityState } from '../src/scenes/types.js';

const noEntities = () => null;
const ctx = (now: Date, entities: Record<string, EntityState> = {}) => ({
  now,
  readEntity: (id: string) => entities[id] ?? null,
});

describe('resolveMood', () => {
  it('returns null when config is missing', () => {
    expect(resolveMood(null, ctx(new Date()))).toBeNull();
    expect(resolveMood(undefined, ctx(new Date()))).toBeNull();
  });

  it('returns null when disabled', () => {
    const cfg: MoodConfig = { enabled: false, strategy: 'manual', moodId: 'clouds' };
    expect(resolveMood(cfg, ctx(new Date()))).toBeNull();
  });

  describe('manual strategy', () => {
    it('resolves a known mood id to a /moods/<file> url with screen blend', () => {
      const cfg: MoodConfig = { enabled: true, strategy: 'manual', moodId: 'clouds' };
      const resolved = resolveMood(cfg, ctx(new Date()));
      expect(resolved).toEqual({ url: '/moods/clouds.mp4', blend: 'screen', opacity: 1 });
    });

    it('returns null when moodId is missing', () => {
      const cfg: MoodConfig = { enabled: true, strategy: 'manual' };
      expect(resolveMood(cfg, ctx(new Date()))).toBeNull();
    });

    it('builds a /moods/<id>.mp4 url for any moodId (file existence is checked client-side)', () => {
      const cfg: MoodConfig = { enabled: true, strategy: 'manual', moodId: 'my-custom' };
      expect(resolveMood(cfg, ctx(new Date()))).toEqual({ url: '/moods/my-custom.mp4', blend: 'screen', opacity: 1 });
    });

    it('threads a custom opacity through to the resolved mood', () => {
      const cfg: MoodConfig = { enabled: true, strategy: 'manual', moodId: 'clouds', opacity: 0.4 };
      expect(resolveMood(cfg, ctx(new Date()))).toEqual({ url: '/moods/clouds.mp4', blend: 'screen', opacity: 0.4 });
    });

    it('clamps opacity outside 0..1', () => {
      const high: MoodConfig = { enabled: true, strategy: 'manual', moodId: 'clouds', opacity: 5 };
      const low: MoodConfig = { enabled: true, strategy: 'manual', moodId: 'clouds', opacity: -1 };
      expect(resolveMood(high, ctx(new Date()))?.opacity).toBe(1);
      expect(resolveMood(low, ctx(new Date()))?.opacity).toBe(0);
    });

    it('rejects moodIds with path separators', () => {
      const cfg: MoodConfig = { enabled: true, strategy: 'manual', moodId: '../etc/passwd' };
      expect(resolveMood(cfg, ctx(new Date()))).toBeNull();
    });
  });

  describe('time strategy', () => {
    it('uses sun.sun above_horizon to pick the day mood', () => {
      const sun: EntityState = {
        entity_id: 'sun.sun',
        state: 'above_horizon',
        attributes: { next_rising: '2030-01-01T00:00:00Z', next_setting: '2030-01-01T22:00:00Z' },
      };
      const cfg: MoodConfig = { enabled: true, strategy: 'time' };
      const resolved = resolveMood(cfg, ctx(new Date('2030-01-01T12:00:00Z'), { 'sun.sun': sun }));
      expect(resolved?.url).toBe('/moods/clouds2.mp4');
    });

    it('uses sun.sun below_horizon to pick the night mood', () => {
      const sun: EntityState = {
        entity_id: 'sun.sun',
        state: 'below_horizon',
        attributes: { next_rising: '2030-01-01T05:00:00Z', next_setting: '2030-01-01T20:00:00Z' },
      };
      const cfg: MoodConfig = { enabled: true, strategy: 'time' };
      const resolved = resolveMood(cfg, ctx(new Date('2030-01-01T02:00:00Z'), { 'sun.sun': sun }));
      expect(resolved?.url).toBe('/moods/stars.mp4');
    });

    it('picks sunrise mood when within 45min of next_rising', () => {
      const sun: EntityState = {
        entity_id: 'sun.sun',
        state: 'below_horizon',
        attributes: { next_rising: '2030-01-01T06:00:00Z', next_setting: '2030-01-01T18:00:00Z' },
      };
      const cfg: MoodConfig = { enabled: true, strategy: 'time' };
      const resolved = resolveMood(cfg, ctx(new Date('2030-01-01T05:30:00Z'), { 'sun.sun': sun }));
      expect(resolved?.url).toBe('/moods/sunrise.mp4');
    });

    it('picks evening mood when within 45min of next_setting', () => {
      const sun: EntityState = {
        entity_id: 'sun.sun',
        state: 'above_horizon',
        attributes: { next_rising: '2030-01-01T06:00:00Z', next_setting: '2030-01-01T18:00:00Z' },
      };
      const cfg: MoodConfig = { enabled: true, strategy: 'time' };
      const resolved = resolveMood(cfg, ctx(new Date('2030-01-01T17:50:00Z'), { 'sun.sun': sun }));
      expect(resolved?.url).toBe('/moods/embers.mp4');
    });

    it('falls back to clock when sun.sun is missing (midday → day)', () => {
      const cfg: MoodConfig = { enabled: true, strategy: 'time' };
      // Use a Date the local-time fallback will treat as midday regardless of TZ.
      const noon = new Date(2030, 0, 1, 13, 0, 0);
      const resolved = resolveMood(cfg, ctx(noon));
      expect(resolved?.url).toBe('/moods/clouds2.mp4');
    });

    it('falls back to clock when sun.sun is missing (deep night → stars)', () => {
      const cfg: MoodConfig = { enabled: true, strategy: 'time' };
      const lateNight = new Date(2030, 0, 1, 23, 0, 0);
      const resolved = resolveMood(cfg, ctx(lateNight));
      expect(resolved?.url).toBe('/moods/stars.mp4');
    });
  });

  describe('weather strategy', () => {
    it('returns null when weatherEntity is missing', () => {
      const cfg: MoodConfig = { enabled: true, strategy: 'weather' };
      expect(resolveMood(cfg, ctx(new Date()))).toBeNull();
    });

    it('returns null when the entity is not in the cache', () => {
      const cfg: MoodConfig = { enabled: true, strategy: 'weather', weatherEntity: 'weather.home' };
      expect(resolveMood(cfg, ctx(new Date()))).toBeNull();
    });

    it.each([
      ['sunny', '/moods/clouds2.mp4'],
      ['partlycloudy', '/moods/clouds2.mp4'],
      ['cloudy', '/moods/clouds2.mp4'],
      ['rainy', '/moods/rain.mp4'],
      ['pouring', '/moods/rain.mp4'],
      ['snowy', '/moods/snow.mp4'],
      ['clear-night', '/moods/stars.mp4'],
    ])('maps weather state %s to %s', (state, expected) => {
      const ent: EntityState = { entity_id: 'weather.home', state, attributes: {} };
      const cfg: MoodConfig = { enabled: true, strategy: 'weather', weatherEntity: 'weather.home' };
      const resolved = resolveMood(cfg, ctx(new Date(), { 'weather.home': ent }));
      expect(resolved?.url).toBe(expected);
    });

    it('falls back to clouds2 for unknown weather conditions', () => {
      const ent: EntityState = { entity_id: 'weather.home', state: 'mysterious', attributes: {} };
      const cfg: MoodConfig = { enabled: true, strategy: 'weather', weatherEntity: 'weather.home' };
      const resolved = resolveMood(cfg, ctx(new Date(), { 'weather.home': ent }));
      expect(resolved?.url).toBe('/moods/clouds2.mp4');
    });
  });
});

describe('timeOfDay (clock fallback)', () => {
  it.each([
    [6, 'sunrise'],
    [12, 'day'],
    [19, 'evening'],
    [23, 'night'],
    [3, 'night'],
  ])('hour %i → %s', (hour, expected) => {
    const d = new Date(2030, 0, 1, hour, 0, 0);
    expect(timeOfDay(d, null)).toBe(expected);
  });
});
