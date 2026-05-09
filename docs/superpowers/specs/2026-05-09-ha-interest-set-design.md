# HA State-Changed Interest-Set Short-Circuit

**Status:** Designed, awaiting plan
**Date:** 2026-05-09

## Problem

Cosmos's HA state-changed handler runs for every entity tick the server receives via `subscribeEntities`. With a large HA instance and noisy entities (power meters, presence sensors, frequently-updating template sensors), the handler can fire many times per second.

For each event, the handler today (`server/src/index.ts:384-406`) does:

1. Builds `widgetEntityIds(scenes)` by iterating every scene × every widget.
2. Iterates every display.
3. For each display, looks up active scene, computes `sceneAmbientEntityIds`, scans widgets, and reads `canvasExtras.entitiesForDisplay(name)`.

This work happens even when the entity isn't referenced by anything active. Wall-tablet browsers running for weeks must avoid death-by-a-thousand-cuts in the server's hot path; the JSON parse cost on the WS already happens unconditionally, but the per-event scan amplifies it ~N× where N is the number of displays × scenes.

Debouncing of downstream pushes is already in place (`markDisplayDirty` / `flushDirty`, 250 ms window plus transition-quiet window) and is unaffected by this change.

## Goal

Add an O(1) early-exit to the state-changed handler that bails when the changed entity is not referenced by any active scene's widgets, ambient reads, or canvas-extras subscriptions.

## Non-Goals

- Reducing WS bytes from HA. The server still uses `subscribeEntities` and receives all entity updates; only the per-event work is reduced. Switching to `subscribe_trigger`/`render_template` for true upstream filtering is out of scope and would break `listEntities()` (used by the admin entity picker).
- Per-display interest sets. A single global set is sufficient — the existing handler already loops displays after the early-exit; that loop is fine to keep.
- Incremental updates to the set. Recompute is cheap relative to entity-tick frequency.

## Design

### Module

New file `server/src/scenes/interest.ts`:

```ts
export interface InterestSetDeps {
  displays: DisplaysRepo;
  scenes: ScenesRepo;
  canvasExtras: CanvasExtrasStore;
}

export interface InterestSet {
  has(entityId: string): boolean;
  recompute(): void;
  size(): number; // for tests/observability
}

export function createInterestSet(deps: InterestSetDeps): InterestSet;
```

The set is the union, across each display's currently-active scene
(`d.currentSceneId ?? d.defaultSceneId`), of:

- widget `entity_id` values (from `(w.config as { entity_id?: string }).entity_id`)
- `sceneAmbientEntityIds(scene)` — `sun.sun` for time-strategy moods and sun-adaptive gradients; the configured weather entity for weather-strategy moods
- `canvasExtras.entitiesForDisplay(d.name)` when the active scene contains any canvas widget

If a display has no active scene, it contributes nothing.

`sceneAmbientEntityIds` currently lives inline in `index.ts`. As part of this change it moves into `scenes/interest.ts` (or a sibling) so the interest module owns its inputs. The existing inline copy in `index.ts` is removed.

### Wiring

In `index.ts`, after repos are built and `canvasExtras` exists:

```ts
const interest = createInterestSet({ displays, scenes, canvasExtras });
interest.recompute();
```

The state-changed handler short-circuits:

```ts
unsubHaStateChange = haClient.onStateChanged((entity) => {
  if (!interest.has(entity.entity_id)) return;
  // ... existing per-display matching ...
});
```

The `widgetEntityIds(scenes)` call inside the handler stays — it's still needed to know whether *this entity* is widget-referenced (vs. ambient/canvas-only). It's now only invoked when the entity is in the interest set, which is rare. (A future refinement could split the interest set into widget/ambient/canvas buckets to drop this call entirely; out of scope.)

`interest.recompute()` is called from these existing hooks:

| Trigger                       | Existing hook                                 |
|-------------------------------|-----------------------------------------------|
| Active scene flips per display| `onSceneChanged`                              |
| Scene/widget mutated          | `onScenesMutated` (already wired to gc canvas)|
| Canvas extras add/remove      | `onCanvasExtrasChanged`                       |
| Display deleted               | `onDisplayDeleted`                            |
| Rotation tick                 | `tickRotation` (after `setCurrentScene`)      |
| Display registered (new)      | After `displays.registerByName` in WS hello   |

The "display registered" hook is the only new wiring point — verify by re-reading `api/ws.ts` during implementation. If a display can be created via REST or rotation without flowing through a state hook, recompute there too.

### Test plan

Unit tests in `server/src/scenes/interest.test.ts` (in-memory SQLite, real repos, fake canvas extras store):

1. Empty when no displays exist.
2. Empty when displays exist but have no active scene.
3. Includes widget `entity_id`s from each active scene.
4. Includes `sun.sun` for active scenes with `mood.strategy = 'time'`.
5. Includes `sun.sun` for active scenes with `background.type = 'gradient'` and `sun_adaptive`.
6. Includes the configured weather entity for `mood.strategy = 'weather'`.
7. Includes canvas-extras entities only when the active scene contains a canvas widget.
8. Does NOT include entities from non-active scenes.
9. Reflects updates after `recompute()` following display/scene/canvas-extras changes.

Integration test in the existing WS test file (or a new `interest-handler.test.ts`):

1. Wire a fake HA client that emits a state_changed for an entity that no scene references; assert no display becomes dirty (`pushSceneTo` is not called within the debounce window).
2. Same setup but for a referenced entity; assert the dirty path runs as before.

### Risk and mitigation

- **Stale set:** if a recompute trigger is missed, real entity changes could be silently dropped. Mitigation: list every existing scene/display/canvas mutation hook in the implementation plan and add `interest.recompute()` to each. Lean toward over-recomputing; the cost is negligible.
- **Race with state_changed during recompute:** `recompute()` is synchronous. JS is single-threaded; no race.
- **Canvas extras keyed by display name vs. the per-name `canvasExtras.entitiesForDisplay` API:** mirror the existing handler's pattern — for each display, read by name. Don't introduce a new aggregation API.

## Out-of-scope follow-ups

- Split the interest set into widget/ambient/canvas buckets so the handler can decide reactivity without re-scanning scenes.
- Replace `subscribeEntities` with targeted `subscribe_trigger`s if profiling shows WS parse is the bottleneck.
- Track per-display interest sets so the handler skips display iteration entirely.
