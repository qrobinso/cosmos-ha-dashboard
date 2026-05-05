import type { Scene, Widget } from '../store/scenes.js';
import type {
  SceneState,
  WidgetState,
  WidgetData,
  ScenePushPayload,
  CalendarData,
  CalendarEvent,
  MediaPlayerData,
  StatisticsData,
  StatisticsPoint,
  EntityState,
} from './types.js';
import type { TransitionDescriptor } from '../transitions/types.js';
import type { TransitionsRepo, OverridesRepo } from '../store/transitions.js';
import { resolveMood } from '../moods/resolve.js';
import {
  MOCK_WEATHER,
  mockEntity,
  mockCalendar,
  mockMediaPlayer,
  mockHistory,
} from './mockData.js';

export type EntityResolver = (entityId: string) => EntityState | Promise<EntityState>;

/** Optional async fetchers for widgets that need data beyond the entity cache. */
export type DataResolvers = {
  /** Resolve a single entity (defaults to the mock fixtures). */
  resolveEntity?: EntityResolver;
  /** Calendar events from a `calendar.*` entity. Falls back to mock when absent. */
  resolveCalendarEvents?: (entityId: string, opts: { start: Date; end: Date }) => Promise<CalendarEvent[]>;
  /** State history for a single entity. Falls back to mock when absent. */
  resolveHistory?: (entityId: string, opts: { start: Date; end: Date }) => Promise<StatisticsPoint[]>;
  /** Synchronous read of a cached entity, used by the mood resolver
   *  (sun.sun, weather entity). Returns null when not present. */
  readEntitySync?: (entityId: string) => EntityState | null;
  /** Base URL of the HA instance (e.g. `http://homeassistant.local:8123`).
   *  Used to absolutize relative `entity_picture` paths returned by HA so
   *  the browser fetches album art / camera snapshots from HA directly
   *  rather than from the Cosmos server. */
  mediaUrlBase?: string;
};

/**
 * Rewrite HA's relative media URLs to go through Cosmos's media proxy.
 *
 * HA's `entity_picture` attribute is typically a relative path like
 * `/api/media_player_proxy/<entity>?token=…`. The browser loads the kiosk
 * from Cosmos's origin and would resolve that against Cosmos and 404. We
 * route it through `/api/ha-media/...` instead — Cosmos's server fetches
 * from HA (using the bearer token) and streams the bytes back. This works
 * for both direct-HA setups (LAN URL) and HA add-ons (Supervisor URL).
 *
 * Also discards obvious junk: some players (Sonos, Cast) report the
 * `entity_id` itself as `entity_picture` when no album art is available —
 * a non-URL string that would resolve as a relative path against the
 * current page and 404 the same way.
 */
export function absolutizeMediaUrl(url: string | undefined, _base: string | undefined): string | undefined {
  if (!url) return undefined;
  // Already an absolute URL (http://, https://, data:, blob:, etc.) — pass through.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  // Leading slash → HA-relative path. Route via Cosmos's proxy.
  if (url.startsWith('/')) {
    return '/api/ha-media' + url;
  }
  // No protocol, no leading slash → not a usable URL (e.g. a bare entity_id).
  return undefined;
}

export const mockEntityResolver: EntityResolver = (entityId) => mockEntity(entityId);

/* -------------------------------------------------------------------------- */
/*  Per-widget data shaping                                                    */
/* -------------------------------------------------------------------------- */

function readNumber(cfg: Record<string, unknown>, key: string, fallback: number): number {
  const v = cfg[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function readString(cfg: Record<string, unknown>, key: string, fallback = ''): string {
  const v = cfg[key];
  return typeof v === 'string' ? v : fallback;
}

async function calendarData(widget: Widget, deps: DataResolvers): Promise<CalendarData> {
  const cfg = widget.config as Record<string, unknown>;
  const entityId = readString(cfg, 'entity_id', 'calendar.home');
  const daysAhead = readNumber(cfg, 'days_ahead', 2);
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(1, Math.min(30, daysAhead)));

  let events: CalendarEvent[];
  if (deps.resolveCalendarEvents) {
    try {
      events = await deps.resolveCalendarEvents(entityId, { start, end });
    } catch {
      events = mockCalendar(entityId).events;
    }
  } else {
    events = mockCalendar(entityId).events;
  }

  return {
    entity_id: entityId,
    friendly_name: entityId.replace(/^calendar\./, '').replace(/_/g, ' '),
    events,
  };
}

async function mediaPlayerData(
  widget: Widget,
  resolver: EntityResolver,
  mediaUrlBase: string | undefined
): Promise<MediaPlayerData> {
  const cfg = widget.config as Record<string, unknown>;
  const entityId = readString(cfg, 'entity_id');
  if (!entityId) return mockMediaPlayer('media_player.unknown');

  // Pull the entity from the cache (or mock fixture); shape it into a MediaPlayerData.
  const entity = await resolver(entityId);
  if (!entity) return mockMediaPlayer(entityId);

  // If the resolver returned a placeholder mock entity (state 'unknown' with no media attrs),
  // fall back to the rich media-player fixture so dev mode shows real-looking content.
  const a = entity.attributes as Record<string, unknown>;
  const hasMediaAttrs =
    typeof a.media_title === 'string' ||
    typeof a.media_artist === 'string' ||
    typeof a.entity_picture === 'string' ||
    typeof a.app_name === 'string';
  if (entity.state === 'unknown' && !hasMediaAttrs) {
    return mockMediaPlayer(entityId);
  }

  const supportedFeatures = typeof a.supported_features === 'number' ? a.supported_features : 0;
  // HA media_player supported_features bitmask (subset)
  const PAUSE = 1, PLAY = 16384, PREV = 16, NEXT = 32, VOLUME_SET = 4, SELECT_SOURCE = 2048;

  const rawArt = typeof a.entity_picture === 'string' ? a.entity_picture : undefined;
  const mediaArtUrl = absolutizeMediaUrl(rawArt, mediaUrlBase);
  const muted = typeof a.is_volume_muted === 'boolean' ? a.is_volume_muted : undefined;

  return {
    entity_id: entity.entity_id,
    state: (['playing','paused','idle','on','off','standby','buffering'].includes(entity.state)
      ? entity.state
      : 'unknown') as MediaPlayerData['state'],
    friendly_name: typeof a.friendly_name === 'string' ? a.friendly_name : undefined,
    title: typeof a.media_title === 'string' ? a.media_title : undefined,
    artist: typeof a.media_artist === 'string' ? a.media_artist : undefined,
    album: typeof a.media_album_name === 'string' ? a.media_album_name : undefined,
    album_art_url: mediaArtUrl,
    position: typeof a.media_position === 'number' ? a.media_position : undefined,
    duration: typeof a.media_duration === 'number' ? a.media_duration : undefined,
    volume: typeof a.volume_level === 'number' ? a.volume_level : undefined,
    muted,
    source: typeof a.source === 'string' ? a.source : undefined,
    app: typeof a.app_name === 'string' ? a.app_name : undefined,
    supports: {
      play_pause: !!(supportedFeatures & (PLAY | PAUSE)),
      next: !!(supportedFeatures & NEXT),
      previous: !!(supportedFeatures & PREV),
      volume_set: !!(supportedFeatures & VOLUME_SET),
      select_source: !!(supportedFeatures & SELECT_SOURCE),
    },
  };
}

async function statisticsData(
  widget: Widget,
  deps: DataResolvers,
  resolver: EntityResolver
): Promise<StatisticsData> {
  const cfg = widget.config as Record<string, unknown>;
  const entityId = readString(cfg, 'entity_id');
  const hoursBack = Math.max(1, Math.min(168, readNumber(cfg, 'hours_back', 24)));
  if (!entityId) return mockHistory('sensor.unknown', hoursBack);

  const end = new Date();
  const start = new Date(end.getTime() - hoursBack * 3_600_000);

  let points: StatisticsPoint[] = [];
  if (deps.resolveHistory) {
    try {
      points = await deps.resolveHistory(entityId, { start, end });
    } catch {
      /* fall through to mock */
    }
  }
  if (points.length === 0) {
    return mockHistory(entityId, hoursBack);
  }

  // Pull friendly_name + unit from the live entity if available.
  const entity = await resolver(entityId);
  const a = (entity?.attributes ?? {}) as Record<string, unknown>;
  const unit = typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : undefined;
  const friendly = typeof a.friendly_name === 'string' ? a.friendly_name : entityId;

  let min = points[0].v;
  let max = points[0].v;
  for (const p of points) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }

  return {
    entity_id: entityId,
    friendly_name: friendly,
    unit,
    current: points[points.length - 1]?.v,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    points,
  };
}

async function dataFor(widget: Widget, deps: DataResolvers): Promise<WidgetData> {
  const resolver = deps.resolveEntity ?? mockEntityResolver;
  switch (widget.kind) {
    case 'clock':
      return null;
    case 'weather':
      return MOCK_WEATHER;
    case 'entity_tile': {
      const entityId = readString(widget.config as Record<string, unknown>, 'entity_id');
      return await resolver(entityId);
    }
    case 'calendar':
      return await calendarData(widget, deps);
    case 'media_player':
      return await mediaPlayerData(widget, resolver, deps.mediaUrlBase);
    case 'statistics':
      return await statisticsData(widget, deps, resolver);
  }
}

/* -------------------------------------------------------------------------- */
/*  Public assembler API                                                       */
/* -------------------------------------------------------------------------- */

export async function buildSceneState(
  scene: Scene,
  safeArea: { top: number; right: number; bottom: number; left: number },
  resolverOrDeps: EntityResolver | DataResolvers = mockEntityResolver
): Promise<SceneState> {
  // Backwards-compat: callers that pass a plain resolver function still work.
  const deps: DataResolvers =
    typeof resolverOrDeps === 'function'
      ? { resolveEntity: resolverOrDeps }
      : resolverOrDeps;

  const widgets: WidgetState[] = [];
  for (const w of scene.widgets) {
    widgets.push({ ...w, data: await dataFor(w, deps) });
  }
  const resolvedMood = resolveMood(scene.mood, {
    now: new Date(),
    readEntity: deps.readEntitySync ?? (() => null),
  });
  return {
    id: scene.id,
    name: scene.name,
    layout: scene.layout,
    background: scene.background,
    typography: scene.typography,
    defaultTransitionId: scene.defaultTransitionId,
    floatWidgets: scene.floatWidgets,
    mood: scene.mood,
    widgets,
    safeArea,
    ...(resolvedMood ? { resolvedMood } : {}),
  };
}

export type AssemblePushArgs = {
  scene: Scene;
  safeArea: { top: number; right: number; bottom: number; left: number };
  previousSceneId: string | null;
  transitions: TransitionsRepo;
  overrides: OverridesRepo;
  explicitTransitionId?: string | null;
  resolver?: EntityResolver;
  /** Optional async fetchers for calendar / history. */
  resolveCalendarEvents?: DataResolvers['resolveCalendarEvents'];
  resolveHistory?: DataResolvers['resolveHistory'];
  /** Synchronous entity reader for the mood engine (sun.sun, weather.*). */
  readEntitySync?: DataResolvers['readEntitySync'];
  /** Base URL of the HA instance for absolutizing media art paths. */
  mediaUrlBase?: string;
};

export function resolveTransition(args: AssemblePushArgs): TransitionDescriptor | null {
  if (args.previousSceneId === null) return null;
  if (args.previousSceneId === args.scene.id) return null;
  if (args.explicitTransitionId) {
    return args.transitions.getById(args.explicitTransitionId);
  }
  const overrideId = args.overrides.get(args.previousSceneId, args.scene.id);
  if (overrideId) return args.transitions.getById(overrideId);
  if (args.scene.defaultTransitionId) return args.transitions.getById(args.scene.defaultTransitionId);
  return null;
}

export async function assemblePush(args: AssemblePushArgs): Promise<ScenePushPayload> {
  const state = await buildSceneState(args.scene, args.safeArea, {
    resolveEntity: args.resolver,
    resolveCalendarEvents: args.resolveCalendarEvents,
    resolveHistory: args.resolveHistory,
    readEntitySync: args.readEntitySync,
    mediaUrlBase: args.mediaUrlBase,
  });
  const transition = resolveTransition(args);
  return transition ? { type: 'scene', state, transition } : { type: 'scene', state };
}
