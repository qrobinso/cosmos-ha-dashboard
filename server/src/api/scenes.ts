import type { FastifyInstance } from 'fastify';
import type { ScenesRepo, SceneInput, Scene } from '../store/scenes.js';
import { WIDGET_KINDS } from '../store/scenes.js';
import type { DisplaysRepo } from '../store/displays.js';
import type { TransitionsRepo } from '../store/transitions.js';
import type { AlertManager } from '../scenes/alerts.js';
import type { SceneState } from '../scenes/types.js';

const WIDGET_KINDS_SET = new Set<string>(WIDGET_KINDS);
function validateMood(mood: unknown): string | null {
  if (mood === undefined) return null;
  if (typeof mood !== 'object' || mood === null) return 'mood must be an object';
  const m = mood as Record<string, unknown>;
  if (typeof m.enabled !== 'boolean') return 'mood.enabled must be boolean';
  // When the mood is disabled, the rest of the fields are dormant — strategy
  // / moodId / weatherEntity don't need to be valid (or even present). Only
  // opacity is still validated since it applies on the off→on transition.
  if (!m.enabled) {
    if (m.opacity !== undefined) {
      if (typeof m.opacity !== 'number' || !Number.isFinite(m.opacity) || m.opacity < 0 || m.opacity > 1) {
        return 'mood.opacity must be a number between 0 and 1';
      }
    }
    return null;
  }
  if (m.strategy !== 'manual' && m.strategy !== 'time' && m.strategy !== 'weather') {
    return 'mood.strategy must be manual, time, or weather';
  }
  if (m.strategy === 'manual') {
    if (typeof m.moodId !== 'string' || m.moodId.trim() === '' || /[\\/]/.test(m.moodId)) {
      return 'mood.moodId must be a non-empty string without slashes';
    }
  }
  if (m.strategy === 'weather') {
    if (typeof m.weatherEntity !== 'string' || !m.weatherEntity.startsWith('weather.')) {
      return 'mood.weatherEntity must be a weather.* entity id';
    }
  }
  if (m.opacity !== undefined) {
    if (typeof m.opacity !== 'number' || !Number.isFinite(m.opacity) || m.opacity < 0 || m.opacity > 1) {
      return 'mood.opacity must be a number between 0 and 1';
    }
  }
  return null;
}

/** Validate the `background` field. Catches the silent-corruption bug
 *  where a client coerces the JS object to a JSON string before send;
 *  without this guard, the string would persist to disk and the wall
 *  display couldn't render it. Solid + gradient unions both checked. */
function validateBackground(bg: unknown): string | null {
  if (typeof bg !== 'object' || bg === null || Array.isArray(bg)) {
    return 'background must be an object (got ' + (typeof bg) + (Array.isArray(bg) ? ' array' : '') + ')';
  }
  const b = bg as Record<string, unknown>;
  if (b.type === 'solid') {
    if (typeof b.color !== 'string' || b.color.trim() === '') {
      return 'background.color must be a non-empty string for solid backgrounds';
    }
    return null;
  }
  if (b.type === 'gradient') {
    if (!Array.isArray(b.colors)) return 'background.colors must be an array of CSS colors';
    if (b.colors.some((c) => typeof c !== 'string')) return 'background.colors entries must be strings';
    if (b.speed !== undefined && b.speed !== 'slow' && b.speed !== 'medium' && b.speed !== 'fast') {
      return 'background.speed must be slow | medium | fast';
    }
    if (b.style !== undefined && b.style !== 'mesh' && b.style !== 'linear' && b.style !== 'radial') {
      return 'background.style must be mesh | linear | radial';
    }
    return null;
  }
  return 'background.type must be "solid" or "gradient"';
}

/** Kinds that require `config.entity_id` to be a syntactically valid HA
 *  entity reference. We check format only (`domain.id`); the HA cache may
 *  not yet contain the entity at scene-create time, so we don't enforce
 *  existence here. */
const ENTITY_BEARING_KINDS = new Set([
  'weather', 'entity_tile', 'calendar', 'media_player', 'statistics', 'camera',
]);

/** Pattern for HA entity ids — `domain.object_id`. Both halves are
 *  lowercase with digits and underscores, separated by exactly one dot.
 *  Matches HA's own entityId regex. */
const ENTITY_ID_RE = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;

/** Validate a widget position against the scene's layout. Catches the
 *  off-by-one and out-of-grid bugs that previously persisted as broken
 *  scenes that wouldn't render. */
function validatePosition(pos: unknown, layout: { cols: number; rows: number }, label: string): string | null {
  if (typeof pos !== 'object' || pos === null || Array.isArray(pos)) {
    return `${label} must be an object`;
  }
  const p = pos as Record<string, unknown>;
  for (const key of ['col', 'row', 'w', 'h'] as const) {
    const v = p[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
      return `${label}.${key} must be an integer`;
    }
  }
  const col = p.col as number;
  const row = p.row as number;
  const w = p.w as number;
  const h = p.h as number;
  if (col < 1 || row < 1) return `${label}.col and ${label}.row must be >= 1`;
  if (w < 1 || h < 1) return `${label}.w and ${label}.h must be >= 1`;
  if (col + w - 1 > layout.cols) {
    return `${label} extends past layout.cols (${layout.cols}): col=${col} w=${w}`;
  }
  if (row + h - 1 > layout.rows) {
    return `${label} extends past layout.rows (${layout.rows}): row=${row} h=${h}`;
  }
  return null;
}

/** Validate one widget in the SceneInput.widgets array. Returns null on
 *  success or a user-readable error string on failure. Catches missing
 *  config / non-object position / unknown kind early so the API returns
 *  4xx with a clear message instead of crashing the repo with a 500. */
function validateWidget(widget: unknown, index: number, layout: { cols: number; rows: number }): string | null {
  if (typeof widget !== 'object' || widget === null || Array.isArray(widget)) {
    return `widgets[${index}] must be an object`;
  }
  const w = widget as Record<string, unknown>;
  if (typeof w.kind !== 'string' || w.kind.trim() === '') {
    return `widgets[${index}].kind must be a non-empty string`;
  }
  if (!WIDGET_KINDS_SET.has(w.kind)) {
    return `widgets[${index}].kind "${w.kind}" is not a known widget kind (one of: ${WIDGET_KINDS.join(', ')})`;
  }
  const posErr = validatePosition(w.position, layout, `widgets[${index}].position`);
  if (posErr) return posErr;
  // config is required and must be an object (even if empty {} for "no
  // config"). undefined / null would crash JSON.stringify in the repo.
  if (w.config === undefined || w.config === null) {
    return `widgets[${index}].config is required (use {} for no config)`;
  }
  if (typeof w.config !== 'object' || Array.isArray(w.config)) {
    return `widgets[${index}].config must be an object`;
  }
  // Entity-bearing kinds need a syntactically-valid entity_id. Empty / bad
  // formats used to slip through and silently render a blank tile.
  if (ENTITY_BEARING_KINDS.has(w.kind)) {
    const cfg = w.config as Record<string, unknown>;
    const eid = cfg.entity_id;
    if (typeof eid !== 'string' || eid.trim() === '') {
      return `widgets[${index}].config.entity_id is required for kind "${w.kind}"`;
    }
    if (!ENTITY_ID_RE.test(eid)) {
      return `widgets[${index}].config.entity_id "${eid}" is not a valid HA entity id (expected "domain.object_id")`;
    }
  }
  return null;
}

function validateSceneInput(body: unknown): { ok: true; value: SceneInput } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'scene payload must be an object' };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string' || b.name.trim() === '') {
    return { ok: false, error: 'name must be a non-empty string' };
  }
  if (typeof b.layout !== 'object' || b.layout === null || Array.isArray(b.layout)) {
    return { ok: false, error: 'layout must be an object' };
  }
  const layout = b.layout as Record<string, unknown>;
  if (typeof layout.cols !== 'number' || !Number.isInteger(layout.cols) || layout.cols < 1) {
    return { ok: false, error: 'layout.cols must be a positive integer' };
  }
  if (typeof layout.rows !== 'number' || !Number.isInteger(layout.rows) || layout.rows < 1) {
    return { ok: false, error: 'layout.rows must be a positive integer' };
  }
  const bgErr = validateBackground(b.background);
  if (bgErr) return { ok: false, error: bgErr };
  if (typeof b.typography !== 'object' || b.typography === null || Array.isArray(b.typography)) {
    return { ok: false, error: 'typography must be an object' };
  }
  const typo = b.typography as Record<string, unknown>;
  if (typeof typo.font_family !== 'string' || typo.font_family.trim() === '') {
    return { ok: false, error: 'typography.font_family must be a non-empty string' };
  }
  if (typeof typo.font_scale !== 'number' || !Number.isFinite(typo.font_scale) || typo.font_scale <= 0) {
    return { ok: false, error: 'typography.font_scale must be a positive number' };
  }
  if (!Array.isArray(b.widgets)) return { ok: false, error: 'widgets must be an array' };
  for (let i = 0; i < b.widgets.length; i++) {
    const err = validateWidget(b.widgets[i], i, { cols: layout.cols, rows: layout.rows });
    if (err) return { ok: false, error: err };
  }
  const moodErr = validateMood(b.mood);
  if (moodErr) return { ok: false, error: moodErr };
  return { ok: true, value: b as unknown as SceneInput };
}

export type SceneRoutesDeps = {
  scenes: ScenesRepo;
  displays: DisplaysRepo;
  transitions: TransitionsRepo;
  onSceneChanged?: (
    displayId: string,
    opts?: { skipHistory?: boolean; explicitTransitionId?: string | null }
  ) => void;
  onRotationChanged?: (displayId: string) => void;
  onDisplayConfigChanged?: (displayId: string) => void;
  /** Fired when a scene is created, renamed, or deleted — used to
   *  refresh MQTT discovery's scene-select options list. */
  onScenesListChanged?: () => void;
  /** Fired after any successful scene OR widget mutation (create, full
   *  update, delete, widget patch, widget content update). The host uses
   *  this to GC the canvas resolver — without it, subscriptions for
   *  removed canvas widgets keep firing entity-update callbacks forever. */
  onScenesMutated?: () => void;
  /** Fired when a display is deleted, with the display id + name. Used
   *  to drop in-memory state, MQTT discovery entries, and rotation timers. */
  onDisplayDeleted?: (displayId: string, name: string) => void;
  /** Server-side alert timer manager. Manual /scene/activate cancels any
   *  active alert before mutating state. */
  alerts?: AlertManager;
  /** Assemble a scene into a full `SceneState` for the read-only preview
   *  endpoint (`GET /api/scenes/:id/preview`), which the admin editor's
   *  hover/tap scene preview iframes load. Wired by `buildHttpApp` — when HA
   *  is connected it uses the live (stateless) data resolvers so widgets
   *  show real values; otherwise it falls back to mock fixtures. It never
   *  passes the stateful canvas resolver, so canvas widgets in the preview
   *  render with their `{{ }}` templates unsubstituted. */
  assembleScenePreview: (scene: Scene) => Promise<SceneState>;
};

export function registerSceneRoutes(app: FastifyInstance, deps: SceneRoutesDeps): void {
  app.post('/api/scenes', async (req, reply) => {
    const v = validateSceneInput(req.body);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    if (v.value.defaultTransitionId != null && deps.transitions.getById(v.value.defaultTransitionId) === null) {
      return reply.code(400).send({ error: `defaultTransitionId "${v.value.defaultTransitionId}" not found` });
    }
    const created = deps.scenes.create(v.value);
    deps.onScenesListChanged?.();
    deps.onScenesMutated?.();
    return created;
  });

  app.get('/api/scenes', async () => deps.scenes.list());

  // Read-only assembled SceneState for the admin editor's scene preview
  // (the hover popover / mobile tap sheet on the scenes list). Same shape the
  // WS hub pushes to displays, minus the transition. Registered before
  // `/api/scenes/:id` is irrelevant — Fastify routes the longer path
  // distinctly — but kept adjacent for readability.
  app.get<{ Params: { id: string } }>('/api/scenes/:id/preview', async (req, reply) => {
    const scene = deps.scenes.get(req.params.id);
    if (!scene) return reply.code(404).send({ error: 'not found' });
    return deps.assembleScenePreview(scene);
  });

  app.get<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const scene = deps.scenes.get(req.params.id);
    if (!scene) return reply.code(404).send({ error: 'not found' });
    return scene;
  });

  app.put<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const v = validateSceneInput(req.body);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    if (v.value.defaultTransitionId != null && deps.transitions.getById(v.value.defaultTransitionId) === null) {
      return reply.code(400).send({ error: `defaultTransitionId "${v.value.defaultTransitionId}" not found` });
    }
    const existing = deps.scenes.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const updated = deps.scenes.update(req.params.id, v.value);
    notifyAffectedDisplays(req.params.id, deps);
    if (existing.name !== updated.name) deps.onScenesListChanged?.();
    deps.onScenesMutated?.();
    return updated;
  });

  /** PATCH /api/scenes/:id — partial update of scene metadata. Accepts any
   *  subset of {name, layout, background, typography, defaultTransitionId,
   *  floatWidgets, mood}; the keys you omit are preserved. Widgets are
   *  never touched here — use PATCH /api/widgets/:id or PUT /api/widgets/:id/content
   *  for those. Used by the agent's "just change the background" flow,
   *  which would otherwise round-trip the entire scene including widgets. */
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/scenes/:id',
    async (req, reply) => {
      const existing = deps.scenes.get(req.params.id);
      if (!existing) return reply.code(404).send({ error: 'not found' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body !== 'object' || Array.isArray(body)) {
        return reply.code(400).send({ error: 'body must be a JSON object' });
      }

      // Validate every provided field BEFORE merging — a string-coerced
      // background or a malformed mood would otherwise silently persist.
      // This is the layer that caught a silent-data-corruption bug where
      // some MCP clients string-coerce typeless schema fields.
      if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim() === '')) {
        return reply.code(400).send({ error: 'name must be a non-empty string' });
      }
      if (body.layout !== undefined && (typeof body.layout !== 'object' || body.layout === null || Array.isArray(body.layout))) {
        return reply.code(400).send({ error: 'layout must be an object' });
      }
      if (body.background !== undefined) {
        const err = validateBackground(body.background);
        if (err) return reply.code(400).send({ error: err });
      }
      if (body.typography !== undefined) {
        if (typeof body.typography !== 'object' || body.typography === null || Array.isArray(body.typography)) {
          return reply.code(400).send({ error: 'typography must be an object' });
        }
        const t = body.typography as Record<string, unknown>;
        if (typeof t.font_family !== 'string' || t.font_family.trim() === '') {
          return reply.code(400).send({ error: 'typography.font_family must be a non-empty string' });
        }
        if (typeof t.font_scale !== 'number' || !Number.isFinite(t.font_scale) || t.font_scale <= 0) {
          return reply.code(400).send({ error: 'typography.font_scale must be a positive number' });
        }
      }
      if (body.defaultTransitionId !== undefined && body.defaultTransitionId !== null && typeof body.defaultTransitionId !== 'string') {
        return reply.code(400).send({ error: 'defaultTransitionId must be a string or null' });
      }
      // Existence check: previously this 500'd on a bad id because the
      // foreign-key violation surfaced from SQLite as a generic error.
      if (typeof body.defaultTransitionId === 'string' && deps.transitions.getById(body.defaultTransitionId) === null) {
        return reply.code(400).send({ error: `defaultTransitionId "${body.defaultTransitionId}" not found` });
      }
      if (body.floatWidgets !== undefined && typeof body.floatWidgets !== 'boolean') {
        return reply.code(400).send({ error: 'floatWidgets must be a boolean' });
      }
      if (body.mood !== undefined) {
        const err = validateMood(body.mood);
        if (err) return reply.code(400).send({ error: err });
      }

      // Build the merged SceneInput. Widgets are preserved verbatim from
      // the existing scene; only top-level metadata is patched.
      const merged = {
        name: typeof body.name === 'string' ? body.name : existing.name,
        layout: (body.layout as typeof existing.layout) ?? existing.layout,
        background: (body.background as typeof existing.background) ?? existing.background,
        typography: (body.typography as typeof existing.typography) ?? existing.typography,
        defaultTransitionId:
          'defaultTransitionId' in body
            ? (body.defaultTransitionId as string | null)
            : existing.defaultTransitionId,
        floatWidgets:
          typeof body.floatWidgets === 'boolean' ? body.floatWidgets : existing.floatWidgets,
        mood: (body.mood as typeof existing.mood) ?? existing.mood,
        widgets: existing.widgets.map((w) => ({
          id: w.id,
          kind: w.kind,
          position: w.position,
          config: w.config,
        })),
      };
      const updated = deps.scenes.update(req.params.id, merged);
      notifyAffectedDisplays(req.params.id, deps);
      if (existing.name !== updated.name) deps.onScenesListChanged?.();
      deps.onScenesMutated?.();
      return updated;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const existing = deps.scenes.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const deletedId = req.params.id;
    deps.scenes.delete(deletedId);
    // Prune dangling references in display rotations. Without this, a
    // rotation pointing at a deleted scene either silently skips that
    // entry forever or (worse) throws when the rotation timer ticks.
    for (const d of deps.displays.list()) {
      if (!d.rotation || !d.rotation.sceneIds.includes(deletedId)) continue;
      const remaining = d.rotation.sceneIds.filter((s) => s !== deletedId);
      const next = remaining.length > 0
        ? { enabled: d.rotation.enabled, sceneIds: remaining, intervalSec: d.rotation.intervalSec }
        : null;
      deps.displays.setRotation(d.id, next);
      deps.onRotationChanged?.(d.id);
    }
    deps.onScenesListChanged?.();
    deps.onScenesMutated?.();
    return reply.code(204).send();
  });

  app.post<{ Params: { name: string }; Body: { sceneId?: unknown; makeDefault?: unknown } }>(
    '/api/displays/:name/assign-scene',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const sceneId = typeof req.body?.sceneId === 'string' ? req.body.sceneId : null;
      if (!sceneId) return reply.code(400).send({ error: 'sceneId required' });
      const scene = deps.scenes.get(sceneId);
      if (!scene) return reply.code(404).send({ error: 'scene not found' });
      deps.scenes.assignToDisplay(sceneId, display.id);
      if (req.body?.makeDefault === true) {
        deps.displays.setDefaultScene(display.id, sceneId);
      }
      deps.onSceneChanged?.(display.id);
      return deps.displays.getById(display.id);
    }
  );

  app.post<{
    Params: { name: string };
    Body: { sceneId?: unknown; transitionId?: unknown };
  }>(
    '/api/displays/:name/scene/activate',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const sceneId = typeof req.body?.sceneId === 'string' ? req.body.sceneId : null;
      if (!sceneId) return reply.code(400).send({ error: 'sceneId required' });
      const scene = deps.scenes.get(sceneId);
      if (!scene) return reply.code(404).send({ error: 'scene not found' });
      const transitionId =
        typeof req.body?.transitionId === 'string' ? req.body.transitionId : null;
      if (transitionId !== null && deps.transitions.getById(transitionId) === null) {
        return reply.code(404).send({ error: 'transition not found' });
      }
      deps.alerts?.cancel(display.id);
      deps.displays.setCurrentScene(display.id, sceneId);
      deps.onSceneChanged?.(display.id, { explicitTransitionId: transitionId });
      return deps.displays.getById(display.id);
    }
  );

  app.post<{
    Params: { name: string };
    Body: { sceneId?: unknown; dwellMs?: unknown; transitionId?: unknown };
  }>(
    '/api/displays/:name/scene/alert',
    async (req, reply) => {
      if (!deps.alerts) return reply.code(503).send({ error: 'alerts not configured' });
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const sceneId = typeof req.body?.sceneId === 'string' ? req.body.sceneId : null;
      if (!sceneId) return reply.code(400).send({ error: 'sceneId required' });
      const dwellMs = req.body?.dwellMs;
      if (typeof dwellMs !== 'number' || !Number.isFinite(dwellMs) || dwellMs <= 0) {
        return reply.code(400).send({ error: 'dwellMs must be a positive number (ms)' });
      }
      const scene = deps.scenes.get(sceneId);
      if (!scene) return reply.code(404).send({ error: 'scene not found' });
      const transitionId =
        typeof req.body?.transitionId === 'string' ? req.body.transitionId : null;
      if (transitionId !== null && deps.transitions.getById(transitionId) === null) {
        return reply.code(404).send({ error: 'transition not found' });
      }
      deps.alerts.fire(display.id, sceneId, dwellMs, { explicitTransitionId: transitionId });
      return { ok: true, displayId: display.id, sceneId, dwellMs };
    }
  );

  app.put<{
    Params: { name: string };
    Body: { enabled?: unknown; sceneIds?: unknown; intervalSec?: unknown };
  }>(
    '/api/displays/:name/rotation',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const enabled = req.body?.enabled === true;
      const sceneIds = Array.isArray(req.body?.sceneIds)
        ? req.body!.sceneIds.filter((x): x is string => typeof x === 'string')
        : [];
      const intervalSec =
        typeof req.body?.intervalSec === 'number' && req.body.intervalSec >= 5
          ? req.body.intervalSec
          : 60;
      if (enabled && sceneIds.length === 0) {
        return reply.code(400).send({ error: 'sceneIds must be non-empty when enabled' });
      }
      for (const sid of sceneIds) {
        if (!deps.scenes.get(sid)) {
          return reply.code(404).send({ error: `scene ${sid} not found` });
        }
      }
      deps.displays.setRotation(display.id, { enabled, sceneIds, intervalSec });
      deps.onRotationChanged?.(display.id);
      return deps.displays.getById(display.id);
    }
  );

  app.put<{
    Params: { name: string };
    Body: { orientation?: unknown };
  }>(
    '/api/displays/:name/orientation',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const orientation = req.body?.orientation;
      if (orientation !== 'landscape' && orientation !== 'portrait') {
        return reply.code(400).send({ error: 'orientation must be landscape or portrait' });
      }
      deps.displays.setOrientation(display.id, orientation);
      deps.onDisplayConfigChanged?.(display.id);
      return deps.displays.getById(display.id);
    }
  );

  app.delete<{ Params: { name: string } }>(
    '/api/displays/:name',
    async (req, reply) => {
      const display = deps.displays.getByName(req.params.name);
      if (!display) return reply.code(404).send({ error: 'display not found' });
      const id = display.id;
      const name = display.name;
      // Stop rotation, drop in-memory state, clear MQTT discovery — all
      // wired up by the host through onDisplayDeleted.
      deps.onDisplayDeleted?.(id, name);
      deps.displays.delete(id);
      return reply.code(204).send();
    }
  );

  // ── Per-widget endpoints ─────────────────────────────────────────────
  //
  // Designed for LLM agents updating canvas widgets in place. The
  // alternative — GET /api/scenes/:id, mutate the widget, PUT the whole
  // scene — forces an agent to round-trip the entire scene (which can be
  // tens of KB of HTML) just to change one field.

  /** GET /api/widgets — flat list of every widget across every scene, with
   *  the parent scene's id + name so an agent can locate "the canvas widget
   *  on the Kitchen scene" without fetching scenes one-by-one. Filters:
   *  `?scene=<id-or-name>` and `?kind=<kind>`. */
  app.get<{ Querystring: { scene?: string; kind?: string; name?: string } }>(
    '/api/widgets',
    async (req) => {
      const sceneFilter = typeof req.query?.scene === 'string' ? req.query.scene : null;
      const kindFilter = typeof req.query?.kind === 'string' ? req.query.kind : null;
      // `name` matches `config.name` case-insensitively. Used by agents and the
      // admin agent to locate "the news-headlines canvas" without knowing its id.
      const nameFilter = typeof req.query?.name === 'string' && req.query.name.length > 0
        ? req.query.name.trim().toLowerCase()
        : null;
      const out: Array<{
        id: string;
        sceneId: string;
        sceneName: string;
        kind: string;
        name: string | null;
        position: unknown;
        config: unknown;
      }> = [];
      for (const s of deps.scenes.list()) {
        if (sceneFilter && s.id !== sceneFilter && s.name !== sceneFilter) continue;
        for (const w of s.widgets) {
          if (kindFilter && w.kind !== kindFilter) continue;
          const cfg = (w.config ?? {}) as Record<string, unknown>;
          const name = typeof cfg.name === 'string' ? cfg.name : null;
          if (nameFilter && (name === null || name.toLowerCase() !== nameFilter)) continue;
          out.push({
            id: w.id,
            sceneId: s.id,
            sceneName: s.name,
            kind: w.kind,
            name,
            position: w.position,
            config: w.config,
          });
        }
      }
      return out;
    }
  );

  /** PATCH /api/widgets/:widgetId — partial update of a single widget.
   *  Body: `{ position?, config? }`. The `config` object is shallow-merged
   *  into the existing config (so `{config: {content: "<div>..."}}` only
   *  touches that one key); pass an empty config to clear nothing. Returns
   *  the parent scene. Re-pushes to every display using the scene. */
  app.patch<{
    Params: { widgetId: string };
    Body: { position?: unknown; config?: unknown };
  }>(
    '/api/widgets/:widgetId',
    async (req, reply) => {
      const widgetId = req.params.widgetId;
      const found = findWidgetWithScene(widgetId, deps);
      if (!found) return reply.code(404).send({ error: 'widget not found' });
      const { scene, widget, index } = found;

      const body = req.body ?? {};
      // No-fields = silent no-op was confusing for agents — they'd believe
      // their patch landed when nothing changed. Reject with a clear 400.
      if (body.position === undefined && body.config === undefined) {
        return reply.code(400).send({ error: 'patch body must include at least one of "position" or "config"' });
      }
      if (body.position !== undefined) {
        const err = validatePosition(body.position, scene.layout, 'position');
        if (err) return reply.code(400).send({ error: err });
      }
      let mergedConfig: Record<string, unknown> | null = null;
      if (body.config !== undefined) {
        if (typeof body.config !== 'object' || body.config === null || Array.isArray(body.config)) {
          return reply.code(400).send({ error: 'config must be an object' });
        }
        mergedConfig = { ...(widget.config ?? {}), ...(body.config as Record<string, unknown>) };
        // If the merged config still names an entity for an entity-bearing
        // kind, validate the format. Patches that touch entity_id must
        // produce a syntactically valid id.
        if (ENTITY_BEARING_KINDS.has(widget.kind)) {
          const eid = mergedConfig.entity_id;
          if (typeof eid !== 'string' || eid.trim() === '') {
            return reply.code(400).send({
              error: `config.entity_id is required for kind "${widget.kind}"`,
            });
          }
          if (!ENTITY_ID_RE.test(eid)) {
            return reply.code(400).send({
              error: `config.entity_id "${eid}" is not a valid HA entity id (expected "domain.object_id")`,
            });
          }
        }
      }
      const newWidgets = scene.widgets.map((w, i) => {
        if (i !== index) return w;
        const next: typeof widget = { ...w };
        if (body.position !== undefined) {
          next.position = body.position as typeof widget.position;
        }
        if (mergedConfig !== null) {
          next.config = mergedConfig;
        }
        return next;
      });

      const updated = deps.scenes.update(scene.id, {
        name: scene.name,
        layout: scene.layout,
        background: scene.background,
        typography: scene.typography,
        defaultTransitionId: scene.defaultTransitionId,
        floatWidgets: scene.floatWidgets,
        mood: scene.mood,
        widgets: newWidgets.map((w) => ({ id: w.id, kind: w.kind, position: w.position, config: w.config })),
      });
      notifyAffectedDisplays(scene.id, deps);
      deps.onScenesMutated?.();
      return updated;
    }
  );

  /** PUT /api/widgets/:widgetId/content — agent-friendly shortcut for the
   *  canvas widget's most-edited field. Body is the raw new HTML (sent as
   *  text/plain or text/html). Equivalent to PATCH with
   *  `{config: {content: "..."}}` but without JSON wrapping. Rejects on
   *  non-canvas widgets so callers get an obvious 400 instead of silently
   *  pushing an unrelated string into someone else's config. */
  app.put<{ Params: { widgetId: string } }>(
    '/api/widgets/:widgetId/content',
    async (req, reply) => {
      const widgetId = req.params.widgetId;
      const found = findWidgetWithScene(widgetId, deps);
      if (!found) return reply.code(404).send({ error: 'widget not found' });
      const { scene, widget, index } = found;
      if (widget.kind !== 'canvas') {
        return reply.code(400).send({
          error: `widget is kind "${widget.kind}", not canvas; use PATCH /api/widgets/:id for other kinds`,
        });
      }
      const raw = req.body;
      const content =
        typeof raw === 'string' ? raw :
        // Fastify auto-parses JSON to objects; also accept {content: "..."}.
        (typeof raw === 'object' && raw !== null && typeof (raw as { content?: unknown }).content === 'string')
          ? (raw as { content: string }).content
          : null;
      if (content === null) {
        return reply.code(400).send({ error: 'body must be a string (HTML) or {"content": "..."}' });
      }
      const newWidgets = scene.widgets.map((w, i) =>
        i === index ? { ...w, config: { ...(w.config ?? {}), content } } : w
      );
      const updated = deps.scenes.update(scene.id, {
        name: scene.name,
        layout: scene.layout,
        background: scene.background,
        typography: scene.typography,
        defaultTransitionId: scene.defaultTransitionId,
        floatWidgets: scene.floatWidgets,
        mood: scene.mood,
        widgets: newWidgets.map((w) => ({ id: w.id, kind: w.kind, position: w.position, config: w.config })),
      });
      notifyAffectedDisplays(scene.id, deps);
      deps.onScenesMutated?.();
      return updated;
    }
  );

  /** DELETE /api/widgets/:widgetId — remove a single widget from its parent
   *  scene. Returns the updated scene, re-pushes to displays. Used by the
   *  in-product agent's confirm-required `delete_widget` tool. */
  app.delete<{ Params: { widgetId: string } }>(
    '/api/widgets/:widgetId',
    async (req, reply) => {
      const widgetId = req.params.widgetId;
      const found = findWidgetWithScene(widgetId, deps);
      if (!found) return reply.code(404).send({ error: 'widget not found' });
      const { scene, index } = found;
      const newWidgets = scene.widgets.filter((_, i) => i !== index);
      const updated = deps.scenes.update(scene.id, {
        name: scene.name,
        layout: scene.layout,
        background: scene.background,
        typography: scene.typography,
        defaultTransitionId: scene.defaultTransitionId,
        floatWidgets: scene.floatWidgets,
        mood: scene.mood,
        widgets: newWidgets.map((w) => ({ id: w.id, kind: w.kind, position: w.position, config: w.config })),
      });
      notifyAffectedDisplays(scene.id, deps);
      deps.onScenesMutated?.();
      return updated;
    }
  );
}

/** Find a widget by id across all scenes, returning the parent scene + index
 *  so callers can mutate one widget without re-walking. */
function findWidgetWithScene(
  widgetId: string,
  deps: SceneRoutesDeps
): { scene: ReturnType<ScenesRepo['list']>[number]; widget: ReturnType<ScenesRepo['list']>[number]['widgets'][number]; index: number } | null {
  for (const s of deps.scenes.list()) {
    const i = s.widgets.findIndex((w) => w.id === widgetId);
    if (i !== -1) return { scene: s, widget: s.widgets[i], index: i };
  }
  return null;
}

function notifyAffectedDisplays(sceneId: string, deps: SceneRoutesDeps): void {
  if (!deps.onSceneChanged) return;
  for (const d of deps.displays.list()) {
    if (d.currentSceneId === sceneId || d.defaultSceneId === sceneId) {
      deps.onSceneChanged(d.id);
    }
  }
}
