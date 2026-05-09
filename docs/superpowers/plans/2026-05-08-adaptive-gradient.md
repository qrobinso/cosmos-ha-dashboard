# Adaptive Gradient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a scene's gradient has `adaptive_colors: true`, the server overrides `gradient.colors` with a palette derived from what the scene's widgets are rendering — driven by the display sampling album art and forwarding canvas-iframe color reports — so the gradient tracks media on the wall in real time and the live palette is readable via REST/agent/MCP.

**Architecture:** Server-heavy. The display extracts colors from image-source widgets (`MediaPlayer`) and forwards canvas iframe `cosmos.reportColors` calls; both flow through one `POST /api/displays/:name/palette { widgetId, colors }`. The server holds `Map<displayId, Map<widgetId, string[]>>`, runs a pure reducer, and overrides `gradient.colors` in the assembler the same way `sun_adaptive` does. Scene re-push is fired on resolved-palette change.

**Tech Stack:** TypeScript, Fastify, better-sqlite3 (no schema changes — additive optional JSON field), Svelte 4, `vitest` for server tests. No new server dependencies. Display extractor is pure (offscreen `<canvas>` + `getImageData`).

**Spec:** `docs/superpowers/specs/2026-05-08-adaptive-gradient-design.md`

---

## File Structure

### Server — new files

| File | Responsibility |
|---|---|
| `server/src/scenes/palette.ts` | Pure reducer: `reducePalette(contributions, fallback, targetCount) → string[]` |
| `server/src/store/displayPalette.ts` | In-memory `Map<displayId, Map<widgetId, string[]>>` + last-resolved cache + `set/getResolved/clearDisplay/pruneWidgets` |
| `server/test/palette.test.ts` | Reducer unit tests |
| `server/test/displayPalette.test.ts` | Store unit tests |
| `server/test/palette.api.test.ts` | REST + onPaletteChanged tests |

### Server — modified files

| File | Change |
|---|---|
| `server/src/store/scenes.ts:7-19` | `Background` (gradient variant) gains optional `adaptive_colors?: boolean` |
| `server/src/scenes/assembler.ts:454-458` | Apply `adaptive_colors` override after `sun_adaptive`; thread `adaptivePalette` through `buildSceneState` and `assemblePush` |
| `server/src/api/http.ts` | New `POST` + `GET /api/displays/:name/palette`; new `onPaletteChanged` dep |
| `server/src/api/ws.ts` | Read `displayPalette.getResolved(displayId)` in `buildPayload`, pass into `assemblePush`; clear store on display disconnect; expose `pushSceneTo` already exists |
| `server/src/index.ts` | Construct `displayPalette` store, pass to HttpDeps, wire `onPaletteChanged` → `wssRef?.pushSceneTo(displayId)` |
| `server/src/agent/tools.ts` | Add `get_display_palette({ displayName })` tool |
| `server/test/assembler.test.ts` | Extend with adaptive_colors override behavior |
| `server/test/agent-tools.test.ts` | Extend with `get_display_palette` |

### Display — new files

| File | Responsibility |
|---|---|
| `display/src/lib/scene/extractPalette.ts` | Pure `extractFromImage(HTMLImageElement) → string[]` + `extractFromUrl(url) → Promise<string[]>` |
| `display/src/lib/scene/reportPalette.ts` | `setDisplayName(name)` + `reportWidgetPalette(widgetId, colors)` (POST helper) |

### Display — modified files

| File | Change |
|---|---|
| `display/src/lib/types.ts:3-11` | `Background` gradient gains `adaptive_colors?: boolean` |
| `display/src/routes/+page.svelte` | Call `setDisplayName(name)` once after start |
| `display/src/lib/widgets/MediaPlayer.svelte` | On `data.album_art_url` change, extract + report; clear on unmount/empty |
| `display/src/lib/widgets/canvasBridge.ts` | Add `cosmos.reportColors(colors)` (posts `cosmos:report-colors` message) |
| `display/src/lib/widgets/Canvas.svelte` | Handle `cosmos:report-colors` → `reportWidgetPalette(widget.id, colors)`; clear on unmount |
| `display/src/routes/admin/scenes/[id]/+page.svelte` | New "Adapt colors to widget content" checkbox in gradient block |

### Docs

| File | Change |
|---|---|
| `docs/canvas-widget-agent.md` | Add `cosmos.reportColors` to JS API table + 1 example |
| `docs/canvas-widget.md` | Same, user-facing wording |

### No tests for the display extractor

Display has no test infrastructure today (per `display/CLAUDE.md`). The pixel-quantizer is small and visual; manual smoke (play music, watch the gradient swap) is the gate.

---

## Task 1: Pure palette reducer (TDD)

**Files:**
- Create: `server/src/scenes/palette.ts`
- Test: `server/test/palette.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/palette.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { reducePalette } from '../src/scenes/palette.js';

describe('reducePalette', () => {
  it('returns empty when no contributions', () => {
    expect(reducePalette(new Map(), ['#111111', '#222222', '#333333'], 3)).toEqual([]);
  });

  it('returns single contribution unchanged when distinct enough', () => {
    const contribs = new Map([['w1', ['#ff0000', '#00ff00', '#0000ff']]]);
    expect(reducePalette(contribs, ['#000000'], 3)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });

  it('unions contributions across widgets and dedupes near-duplicates', () => {
    const contribs = new Map([
      ['w1', ['#ff0000', '#ff0202']], // near-duplicate red
      ['w2', ['#00ff00']],
    ]);
    const out = reducePalette(contribs, ['#000000'], 3);
    expect(out.length).toBeLessThanOrEqual(3);
    // Near-duplicates collapse: only one red expected
    const reds = out.filter((c) => c.startsWith('#ff'));
    expect(reds.length).toBe(1);
    expect(out).toContain('#00ff00');
  });

  it('pads from fallback when fewer distinct than targetCount', () => {
    const contribs = new Map([['w1', ['#ff0000']]]);
    const out = reducePalette(contribs, ['#aaaaaa', '#bbbbbb', '#cccccc'], 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('#ff0000');
    expect(out.slice(1)).toEqual(['#aaaaaa', '#bbbbbb']);
  });

  it('orders by total occurrence frequency across contributors', () => {
    const contribs = new Map([
      ['w1', ['#ff0000', '#00ff00']],
      ['w2', ['#00ff00']],            // green appears twice
      ['w3', ['#0000ff']],
    ]);
    const out = reducePalette(contribs, ['#000000'], 3);
    expect(out[0]).toBe('#00ff00');   // green wins on frequency
  });

  it('ignores empty contributor entries', () => {
    const contribs = new Map([
      ['w1', []],
      ['w2', ['#ff0000']],
    ]);
    expect(reducePalette(contribs, ['#000000'], 3)).toContain('#ff0000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --workspace server test -- palette.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `server/src/scenes/palette.ts`:

```typescript
/**
 * Pure reducer that turns per-widget palette contributions into the final
 * gradient palette. Lives on the server: every display's contributions live
 * in `displayPalette` and feed this reducer in `assemblePush` /
 * `displayPalette.set`.
 *
 *   contributions  Map<widgetId, [#rrggbb, ...]>
 *   fallback       The user's `gradient.colors` — used to pad if we don't
 *                  have enough distinct colors to fill the gradient.
 *   targetCount    Number of stops to return. The kiosk uses 3.
 *
 * Empty contributions → empty output (the caller treats empty as "don't
 * override the user's colors"). All-near-duplicate contributions collapse
 * to one stop and get padded.
 */
export function reducePalette(
  contributions: Map<string, string[]>,
  fallback: string[],
  targetCount: number
): string[] {
  // Frequency-count every color across all widgets, ignoring empty entries.
  const freq = new Map<string, number>();
  for (const colors of contributions.values()) {
    for (const c of colors) {
      const norm = c.toLowerCase();
      freq.set(norm, (freq.get(norm) ?? 0) + 1);
    }
  }
  if (freq.size === 0) return [];

  // Sort by frequency desc, then by hex asc for determinism on ties.
  const sorted = [...freq.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  // Greedy dedupe: keep colors that aren't near a color already kept.
  const kept: string[] = [];
  for (const [color] of sorted) {
    if (kept.length >= targetCount) break;
    if (kept.every((k) => hslDistance(k, color) >= 0.15)) kept.push(color);
  }

  // Pad from fallback (skip near-duplicates) until we hit targetCount.
  for (const c of fallback) {
    if (kept.length >= targetCount) break;
    const norm = c.toLowerCase();
    if (kept.every((k) => hslDistance(k, norm) >= 0.15)) kept.push(norm);
  }

  return kept;
}

/** HSL-distance proxy. Hex strings only; behavior is undefined for malformed
 *  input, which the reducer never produces (validated upstream at the API). */
function hslDistance(a: string, b: string): number {
  const [hA, sA, lA] = hexToHsl(a);
  const [hB, sB, lB] = hexToHsl(b);
  // Hue is circular; take the shorter arc, normalised to [0, 0.5].
  const dh = Math.min(Math.abs(hA - hB), 1 - Math.abs(hA - hB));
  const ds = Math.abs(sA - sB);
  const dl = Math.abs(lA - lB);
  return Math.sqrt(dh * dh + ds * ds * 0.5 + dl * dl * 0.5);
}

function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    case b: h = ((r - g) / d + 4) / 6; break;
  }
  return [h, s, l];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --workspace server test -- palette.test
```

Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/scenes/palette.ts server/test/palette.test.ts
git commit -m "feat(palette): pure reducer for per-widget palette contributions"
```

---

## Task 2: Display palette store (TDD)

**Files:**
- Create: `server/src/store/displayPalette.ts`
- Test: `server/test/displayPalette.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/displayPalette.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createDisplayPaletteStore, type DisplayPaletteStore } from '../src/store/displayPalette.js';

describe('displayPalette', () => {
  let store: DisplayPaletteStore;
  beforeEach(() => {
    store = createDisplayPaletteStore();
  });

  it('starts empty', () => {
    expect(store.getResolved('d1')).toEqual({ colors: [], updatedAt: null });
  });

  it('set returns resolvedChanged=true on first contribution', () => {
    const r = store.set('d1', 'w1', ['#ff0000', '#00ff00', '#0000ff']);
    expect(r.resolvedChanged).toBe(true);
    expect(store.getResolved('d1').colors.length).toBeGreaterThan(0);
  });

  it('set returns resolvedChanged=false on a no-op write', () => {
    store.set('d1', 'w1', ['#ff0000']);
    const r = store.set('d1', 'w1', ['#ff0000']);
    expect(r.resolvedChanged).toBe(false);
  });

  it('set returns resolvedChanged=true when a different widget updates the resolved set', () => {
    store.set('d1', 'w1', ['#ff0000']);
    const r = store.set('d1', 'w2', ['#00ff00']);
    expect(r.resolvedChanged).toBe(true);
  });

  it('empty colors clears the widget slot and may shrink the resolved set', () => {
    store.set('d1', 'w1', ['#ff0000']);
    store.set('d1', 'w2', ['#00ff00']);
    const r = store.set('d1', 'w1', []);
    expect(r.resolvedChanged).toBe(true);
    expect(store.getResolved('d1').colors).not.toContain('#ff0000');
  });

  it('clearDisplay drops every contribution for that display', () => {
    store.set('d1', 'w1', ['#ff0000']);
    store.set('d2', 'w1', ['#00ff00']);
    store.clearDisplay('d1');
    expect(store.getResolved('d1').colors).toEqual([]);
    expect(store.getResolved('d2').colors.length).toBeGreaterThan(0);
  });

  it('pruneWidgets keeps only listed widget ids', () => {
    store.set('d1', 'w1', ['#ff0000']);
    store.set('d1', 'w2', ['#00ff00']);
    store.pruneWidgets('d1', new Set(['w2']));
    const colors = store.getResolved('d1').colors;
    expect(colors).not.toContain('#ff0000');
    expect(colors).toContain('#00ff00');
  });

  it('updatedAt advances on each successful change', async () => {
    store.set('d1', 'w1', ['#ff0000']);
    const t1 = store.getResolved('d1').updatedAt;
    expect(t1).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    store.set('d1', 'w2', ['#00ff00']);
    const t2 = store.getResolved('d1').updatedAt;
    expect(t2 === null ? 0 : Date.parse(t2)).toBeGreaterThan(t1 === null ? 0 : Date.parse(t1));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --workspace server test -- displayPalette.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `server/src/store/displayPalette.ts`:

```typescript
import { reducePalette } from '../scenes/palette.js';

/** Per-server, per-display palette state. Ephemeral runtime state; lives in
 *  process memory like the canvas-extras store. The display posts per-widget
 *  contributions, the server reduces, the assembler reads `getResolved`. */
export type DisplayPaletteStore = {
  /** Replace one widget's contribution. Empty colors clears it. Returns
   *  whether the resolved palette changed (used to gate a scene re-push). */
  set(displayId: string, widgetId: string, colors: string[]): { resolvedChanged: boolean };
  /** Read the most recent resolved palette for a display. Empty when nothing
   *  has been reported. */
  getResolved(displayId: string): { colors: string[]; updatedAt: string | null };
  /** Drop every contribution for a display (called on disconnect). */
  clearDisplay(displayId: string): void;
  /** Drop contributions whose widget id isn't in `keep` (called from the
   *  assembler so removed widgets stop influencing the palette). */
  pruneWidgets(displayId: string, keep: Set<string>): void;
};

type Entry = {
  contributions: Map<string, string[]>;
  resolved: string[];
  updatedAt: string;
};

/** Reducer is called with no fallback here — the caller (assembler) supplies
 *  the user's gradient.colors as fallback at apply time. The store just
 *  tracks raw contributions and a "what would the resolved set look like"
 *  derived view used purely for change detection. */
const TARGET_COUNT = 3;

export function createDisplayPaletteStore(): DisplayPaletteStore {
  const byDisplay = new Map<string, Entry>();

  function recompute(entry: Entry): string[] {
    return reducePalette(entry.contributions, [], TARGET_COUNT);
  }

  return {
    set(displayId, widgetId, colors) {
      let entry = byDisplay.get(displayId);
      if (!entry) {
        entry = { contributions: new Map(), resolved: [], updatedAt: new Date().toISOString() };
        byDisplay.set(displayId, entry);
      }
      if (colors.length === 0) {
        entry.contributions.delete(widgetId);
      } else {
        entry.contributions.set(widgetId, colors);
      }
      const next = recompute(entry);
      const changed =
        next.length !== entry.resolved.length ||
        next.some((c, i) => c !== entry.resolved[i]);
      if (changed) {
        entry.resolved = next;
        entry.updatedAt = new Date().toISOString();
      }
      return { resolvedChanged: changed };
    },
    getResolved(displayId) {
      const entry = byDisplay.get(displayId);
      if (!entry) return { colors: [], updatedAt: null };
      return { colors: [...entry.resolved], updatedAt: entry.updatedAt };
    },
    clearDisplay(displayId) {
      byDisplay.delete(displayId);
    },
    pruneWidgets(displayId, keep) {
      const entry = byDisplay.get(displayId);
      if (!entry) return;
      let touched = false;
      for (const id of entry.contributions.keys()) {
        if (!keep.has(id)) {
          entry.contributions.delete(id);
          touched = true;
        }
      }
      if (touched) {
        entry.resolved = recompute(entry);
        entry.updatedAt = new Date().toISOString();
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --workspace server test -- displayPalette.test
```

Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/store/displayPalette.ts server/test/displayPalette.test.ts
git commit -m "feat(palette): in-memory per-display palette store"
```

---

## Task 3: Background gains `adaptive_colors` flag (server side)

**Files:**
- Modify: `server/src/store/scenes.ts:7-19`

- [ ] **Step 1: Add the optional flag**

Edit `server/src/store/scenes.ts`. Replace:

```typescript
  | {
      type: 'gradient';
      colors: string[];
      speed: 'slow' | 'medium' | 'fast';
      style: 'mesh' | 'linear' | 'radial';
      /** When true, the server overrides `colors` at scene-push time based on
       *  the current time-of-day bucket (read from HA's `sun.sun` entity, with
       *  a clock fallback). The user-specified colors above are ignored while
       *  this flag is on. */
      sun_adaptive?: boolean;
    };
```

with:

```typescript
  | {
      type: 'gradient';
      colors: string[];
      speed: 'slow' | 'medium' | 'fast';
      style: 'mesh' | 'linear' | 'radial';
      /** When true, the server overrides `colors` at scene-push time based on
       *  the current time-of-day bucket (read from HA's `sun.sun` entity, with
       *  a clock fallback). The user-specified colors above are ignored while
       *  this flag is on. */
      sun_adaptive?: boolean;
      /** When true, the server overrides `colors` at scene-push time with
       *  the resolved palette reported by this display (album art, canvas
       *  reports, …). Composes with `sun_adaptive`: sun runs first as the
       *  resting palette, this overrides it whenever something is reporting. */
      adaptive_colors?: boolean;
    };
```

- [ ] **Step 2: Verify build**

```bash
npm --workspace server run build
```

Expected: clean build (additive optional field; no consumer breakage).

- [ ] **Step 3: Run server tests to confirm nothing regresses**

```bash
npm --workspace server test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add server/src/store/scenes.ts
git commit -m "feat(scenes): adaptive_colors flag on gradient backgrounds"
```

---

## Task 4: Assembler applies the override (TDD)

**Files:**
- Modify: `server/src/scenes/assembler.ts` (signature + override block)
- Modify: `server/test/assembler.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Open `server/test/assembler.test.ts` and add at the end of the existing `describe` block:

```typescript
  describe('adaptive_colors override', () => {
    const baseScene = {
      id: 's1',
      name: 'Test',
      layout: { cols: 12, rows: 8, items: [] as any[] },
      background: {
        type: 'gradient' as const,
        colors: ['#111111', '#222222', '#333333'],
        speed: 'medium' as const,
        style: 'mesh' as const,
        adaptive_colors: true,
      },
      typography: { font_family: 'Inter', font_scale: 1 },
      defaultTransitionId: null,
      floatWidgets: false,
      mood: { enabled: false, strategy: 'manual' as const },
      widgets: [],
    };

    it('overrides gradient.colors when adaptive_colors=true and palette non-empty', async () => {
      const state = await buildSceneState(baseScene, { top: 0, right: 0, bottom: 0, left: 0 }, undefined, undefined, ['#abcdef', '#fedcba']);
      expect(state.background.type).toBe('gradient');
      if (state.background.type !== 'gradient') return;
      expect(state.background.colors).toEqual(['#abcdef', '#fedcba']);
    });

    it('keeps user colors when adaptive_colors=true but palette is empty', async () => {
      const state = await buildSceneState(baseScene, { top: 0, right: 0, bottom: 0, left: 0 }, undefined, undefined, []);
      if (state.background.type !== 'gradient') return;
      expect(state.background.colors).toEqual(['#111111', '#222222', '#333333']);
    });

    it('keeps user colors when adaptive_colors=false even if palette supplied', async () => {
      const scene = { ...baseScene, background: { ...baseScene.background, adaptive_colors: false } };
      const state = await buildSceneState(scene, { top: 0, right: 0, bottom: 0, left: 0 }, undefined, undefined, ['#abcdef']);
      if (state.background.type !== 'gradient') return;
      expect(state.background.colors).toEqual(['#111111', '#222222', '#333333']);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --workspace server test -- assembler
```

Expected: FAIL — `buildSceneState` receives 4 args, not 5.

- [ ] **Step 3: Modify the assembler signature and override block**

Edit `server/src/scenes/assembler.ts`. Find:

```typescript
export async function buildSceneState(
  scene: Scene,
  safeArea: { top: number; right: number; bottom: number; left: number },
  resolverOrDeps: EntityResolver | DataResolvers = mockEntityResolver,
  canvasFetchPolicy?: CanvasFetchPolicy
): Promise<SceneState> {
```

Replace with:

```typescript
export async function buildSceneState(
  scene: Scene,
  safeArea: { top: number; right: number; bottom: number; left: number },
  resolverOrDeps: EntityResolver | DataResolvers = mockEntityResolver,
  canvasFetchPolicy?: CanvasFetchPolicy,
  adaptivePalette?: string[]
): Promise<SceneState> {
```

Then find the existing `sun_adaptive` block (around line 454):

```typescript
  let background = scene.background;
  if (background.type === 'gradient' && background.sun_adaptive) {
    const colors = resolveSunGradient(now, readEntitySync('sun.sun'));
    background = { ...background, colors };
  }
```

Replace with:

```typescript
  let background = scene.background;
  if (background.type === 'gradient' && background.sun_adaptive) {
    const colors = resolveSunGradient(now, readEntitySync('sun.sun'));
    background = { ...background, colors };
  }
  if (
    background.type === 'gradient' &&
    background.adaptive_colors &&
    adaptivePalette &&
    adaptivePalette.length > 0
  ) {
    background = { ...background, colors: adaptivePalette };
  }
```

- [ ] **Step 4: Thread `adaptivePalette` through `assemblePush`**

In the same file, find the `AssemblePushArgs` type and add:

```typescript
  /** Resolved per-display palette. When the scene's gradient has
   *  `adaptive_colors` enabled and this is non-empty, it overrides
   *  `gradient.colors`. Read from `displayPalette.getResolved(displayId)`
   *  in the WS hub's `buildPayload`. */
  adaptivePalette?: string[];
```

Then in `assemblePush`, find the `buildSceneState` call and update it:

```typescript
  const state = await buildSceneState(
    args.scene,
    args.safeArea,
    {
      resolveEntity: args.resolver,
      resolveCalendarEvents: args.resolveCalendarEvents,
      resolveHistory: args.resolveHistory,
      resolveWeatherForecasts: args.resolveWeatherForecasts,
      readEntitySync: args.readEntitySync,
      mediaUrlBase: args.mediaUrlBase,
      canvasResolver: args.canvasResolver,
      canvasExtras: args.canvasExtras,
    },
    args.canvasFetchPolicy,
    args.adaptivePalette
  );
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm --workspace server test -- assembler
```

Expected: PASS, all 3 new tests + existing assembler tests green.

- [ ] **Step 6: Commit**

```bash
git add server/src/scenes/assembler.ts server/test/assembler.test.ts
git commit -m "feat(assembler): apply adaptive_colors override after sun_adaptive"
```

---

## Task 5: REST endpoints for palette (TDD)

**Files:**
- Modify: `server/src/api/http.ts` (add deps + endpoints)
- Create: `server/test/palette.api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/test/palette.api.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { createScenesRepo } from '../src/store/scenes.js';
import { createTransitionsRepo, createOverridesRepo } from '../src/store/transitions.js';
import { createDisplayPaletteStore } from '../src/store/displayPalette.js';
import { buildHttpApp } from '../src/api/http.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  // Pre-register a display so name → id resolves.
  displays.registerByName('kitchen-wall');
  return {
    displays,
    settings: createSettingsRepo(db),
    scenes: createScenesRepo(db),
    transitions: createTransitionsRepo(db),
    overrides: createOverridesRepo(db),
  };
}

describe('palette endpoints', () => {
  let app: Awaited<ReturnType<typeof buildHttpApp>>;
  let displayPalette: ReturnType<typeof createDisplayPaletteStore>;
  let changeEvents: string[];

  beforeEach(async () => {
    displayPalette = createDisplayPaletteStore();
    changeEvents = [];
    app = await buildHttpApp({
      ...setup(),
      displayPalette,
      onPaletteChanged: (displayId) => changeEvents.push(displayId),
    });
  });

  it('GET returns empty when nothing has been reported', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/displays/kitchen-wall/palette' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ colors: [], updatedAt: null });
  });

  it('POST stores a contribution and round-trips through GET', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000', '#00ff00', '#0000ff'] },
    });
    expect(post.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: '/api/displays/kitchen-wall/palette' });
    const body = get.json();
    expect(body.colors.length).toBeGreaterThan(0);
    expect(body.updatedAt).not.toBeNull();
  });

  it('POST fires onPaletteChanged exactly when the resolved set changes', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000'] },
    });
    expect(changeEvents.length).toBe(1);
    // Same payload — no change.
    await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000'] },
    });
    expect(changeEvents.length).toBe(1);
  });

  it('POST rejects non-hex strings with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['not-a-color'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST rejects more than 5 colors with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#000000', '#111111', '#222222', '#333333', '#444444', '#555555'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST accepts empty colors as a clear', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000'] },
    });
    const clear = await app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: [] },
    });
    expect(clear.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: '/api/displays/kitchen-wall/palette' });
    expect(get.json().colors).toEqual([]);
  });

  it('POST returns 404 for an unknown display', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/no-such-display/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000'] },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --workspace server test -- palette.api
```

Expected: FAIL — `displayPalette` and `onPaletteChanged` are not on `HttpDeps`; endpoints don't exist.

- [ ] **Step 3: Add deps and endpoints to `http.ts`**

In `server/src/api/http.ts` add the import:

```typescript
import type { DisplayPaletteStore } from '../store/displayPalette.js';
```

In `HttpDeps` (around line 57), add:

```typescript
  /** Per-display palette store for the adaptive-gradient feature. */
  displayPalette?: DisplayPaletteStore;
  /** Fired by the palette POST endpoint when the resolved set actually
   *  changed for a display. The host wires this to a per-display scene
   *  re-push so the new gradient.colors land on the wall. */
  onPaletteChanged?: (displayId: string) => void;
```

Then add the route registrations after the `canvas-fetch` block (right before `registerTransitionRoutes`):

```typescript
  app.get<{ Params: { name: string } }>('/api/displays/:name/palette', async (req, reply) => {
    const display = deps.displays.getByName(req.params.name);
    if (!display) return reply.code(404).send({ error: 'display not found' });
    const result = deps.displayPalette?.getResolved(display.id) ?? { colors: [], updatedAt: null };
    return result;
  });

  app.post<{
    Params: { name: string };
    Body: { widgetId?: unknown; colors?: unknown };
  }>('/api/displays/:name/palette', async (req, reply) => {
    const display = deps.displays.getByName(req.params.name);
    if (!display) return reply.code(404).send({ error: 'display not found' });
    const widgetId = typeof req.body?.widgetId === 'string' ? req.body.widgetId : '';
    if (!widgetId) return reply.code(400).send({ error: 'widgetId is required' });
    const raw = req.body?.colors;
    if (!Array.isArray(raw)) return reply.code(400).send({ error: 'colors must be an array' });
    if (raw.length > 5) return reply.code(400).send({ error: 'colors must contain at most 5 entries' });
    const colors: string[] = [];
    for (const c of raw) {
      if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) {
        return reply.code(400).send({ error: 'each color must be a #rrggbb string' });
      }
      colors.push(c.toLowerCase());
    }
    const result = deps.displayPalette?.set(display.id, widgetId, colors);
    if (result?.resolvedChanged) deps.onPaletteChanged?.(display.id);
    return reply.code(204).send();
  });
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --workspace server test -- palette.api
```

Expected: PASS — all 7 tests passing.

- [ ] **Step 5: Run full server suite**

```bash
npm --workspace server test
```

Expected: all green (no regressions).

- [ ] **Step 6: Commit**

```bash
git add server/src/api/http.ts server/test/palette.api.test.ts
git commit -m "feat(api): POST/GET /api/displays/:name/palette"
```

---

## Task 6: Wire `displayPalette` through the WS hub

**Files:**
- Modify: `server/src/api/ws.ts`

- [ ] **Step 1: Add the dep type**

In `server/src/api/ws.ts`, locate the `WssDeps` type. Add:

```typescript
  /** When set, `buildPayload` reads the resolved palette here and passes
   *  it into the assembler so adaptive_colors can override gradient.colors. */
  displayPalette?: import('../store/displayPalette.js').DisplayPaletteStore;
```

- [ ] **Step 2: Read the palette in `buildPayload`**

In `buildPayload` (around line 86), find:

```typescript
    const canvasFetchPolicy = readCanvasFetchPolicy(deps.settings);
    const payload = await assemblePush({
      scene,
      safeArea,
      previousSceneId,
      transitions: deps.transitions,
      overrides: deps.overrides,
      explicitTransitionId,
      transitionSpeedMultiplier,
      canvasFetchPolicy,
```

After the `canvasFetchPolicy` line, add:

```typescript
    const adaptivePalette = deps.displayPalette?.getResolved(displayId).colors ?? [];
```

And in the `assemblePush` args object, after `canvasFetchPolicy,` add:

```typescript
      adaptivePalette,
```

- [ ] **Step 3: Prune palette contributions for widgets no longer on the active scene**

In `buildPayload`, after the `lastSceneByDisplay.set(displayId, scene.id);` line, find the existing canvas-extras prune block. Add right after it:

```typescript
    // Drop palette contributions for widgets that are no longer on the active
    // scene. Without this, a widget's colors would linger after it's removed.
    if (deps.displayPalette) {
      const keep = new Set(scene.widgets.map((w) => w.id));
      deps.displayPalette.pruneWidgets(displayId, keep);
    }
```

- [ ] **Step 4: Clear the palette on display disconnect**

In the `wss.on('connection', …)` close handler (around line 135), find:

```typescript
        if (d) {
          deps.onDisplayOffline?.(ownDisplayId, d.name);
          deps.canvasExtrasOnDisconnect?.(d.name);
        }
```

Replace with:

```typescript
        if (d) {
          deps.onDisplayOffline?.(ownDisplayId, d.name);
          deps.canvasExtrasOnDisconnect?.(d.name);
          deps.displayPalette?.clearDisplay(ownDisplayId);
        }
```

- [ ] **Step 5: Build to confirm types**

```bash
npm --workspace server run build
```

Expected: clean build.

- [ ] **Step 6: Run full server suite**

```bash
npm --workspace server test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add server/src/api/ws.ts
git commit -m "feat(ws): thread palette into scene push, prune on scene change, clear on disconnect"
```

---

## Task 7: Wire the store into the entrypoint

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Construct the store and wire callbacks**

In `server/src/index.ts`, find the import block at the top and add:

```typescript
import { createDisplayPaletteStore } from './store/displayPalette.js';
```

Find the construction of other in-memory stores (search for `canvasExtras`). Construct the new store nearby:

```typescript
  const displayPalette = createDisplayPaletteStore();
```

Find the call to `buildHttpApp({ … })`. Add to its args:

```typescript
    displayPalette,
    onPaletteChanged: (displayId) => wssRef?.pushSceneTo(displayId).catch((err) => console.error('pushSceneTo (palette) failed', err)),
```

Find the `attachWss(app, …)` (or equivalent) call. Pass the store:

```typescript
    displayPalette,
```

- [ ] **Step 2: Build**

```bash
npm --workspace server run build
```

Expected: clean build.

- [ ] **Step 3: Run full server suite**

```bash
npm --workspace server test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): construct displayPalette store + wire scene re-push on change"
```

---

## Task 8: Agent tool `get_display_palette` (TDD)

**Files:**
- Modify: `server/src/agent/tools.ts`
- Modify: `server/test/agent-tools.test.ts`

- [ ] **Step 1: Write the failing test**

In `server/test/agent-tools.test.ts`, add a new test inside the existing describe block (after the `list_ha_entities` tests):

```typescript
  it('get_display_palette returns the resolved palette for a display', async () => {
    // Pre-register the display + seed the store via the POST endpoint.
    deps.displays.registerByName('kitchen-wall');
    await deps.app.inject({
      method: 'POST',
      url: '/api/displays/kitchen-wall/palette',
      payload: { widgetId: 'w1', colors: ['#ff0000', '#00ff00'] },
    });
    const result = (await run(tools, 'get_display_palette', { displayName: 'kitchen-wall' })) as { colors: string[]; updatedAt: string | null };
    expect(result.colors.length).toBeGreaterThan(0);
    expect(result.updatedAt).not.toBeNull();
  });

  it('get_display_palette returns empty when nothing has been reported', async () => {
    deps.displays.registerByName('quiet-wall');
    const result = (await run(tools, 'get_display_palette', { displayName: 'quiet-wall' })) as { colors: string[]; updatedAt: string | null };
    expect(result).toEqual({ colors: [], updatedAt: null });
  });
```

> If the test setup doesn't already construct the deps with a `displayPalette` store, add it: `deps = { ..., displayPalette: createDisplayPaletteStore() }` near the top of the test file's `beforeEach`. Match the pattern the existing tests use.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --workspace server test -- agent-tools
```

Expected: FAIL — tool not registered.

- [ ] **Step 3: Add the tool**

In `server/src/agent/tools.ts`, find the existing tool registration (e.g. after `list_ha_entities`). Add:

```typescript
    get_display_palette: tool({
      description: 'Read the live color palette extracted from a display\'s widgets. Returns the colors currently driving the adaptive gradient (if enabled) plus when they were last updated. Empty colors means nothing is being reported. Useful for "what colors are showing on the kitchen wall right now?" questions.',
      parameters: z.object({
        displayName: z.string().describe('The display name (e.g. "kitchen-wall"), as used by /api/displays/<name>/...'),
      }),
      execute: async ({ displayName }) => inject(app, {
        method: 'GET',
        url: `/api/displays/${encodeURIComponent(displayName)}/palette`,
      }),
    }),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --workspace server test -- agent-tools
```

Expected: PASS — both new tests green.

- [ ] **Step 5: Commit**

```bash
git add server/src/agent/tools.ts server/test/agent-tools.test.ts
git commit -m "feat(agent): get_display_palette tool"
```

---

## Task 9: Display extractor (no test infra; manual smoke)

**Files:**
- Create: `display/src/lib/scene/extractPalette.ts`

- [ ] **Step 1: Write the implementation**

Create `display/src/lib/scene/extractPalette.ts`:

```typescript
/** Extract up to 5 dominant `#rrggbb` colors from an image. Pure browser
 *  code: paints to a 64×64 offscreen canvas, samples pixels, bins into a
 *  5×5×5 RGB histogram, drops near-greyscale buckets, returns the top
 *  buckets sorted by population.
 *
 *  Used by widget renderers (e.g. MediaPlayer.svelte for album art) to
 *  produce a palette that's then forwarded to the server via
 *  `reportWidgetPalette`. */

const SAMPLE_SIZE = 64;
const BINS_PER_AXIS = 5;
const SATURATION_FLOOR = 0.18; // skip greys

export function extractFromImage(img: HTMLImageElement): string[] {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    // CORS-tainted canvas — bail. Caller must use crossorigin="anonymous".
    return [];
  }
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue; // skip transparent
    if (isGrey(r, g, b)) continue;
    const key = bin(r) * BINS_PER_AXIS * BINS_PER_AXIS + bin(g) * BINS_PER_AXIS + bin(b);
    const e = buckets.get(key);
    if (e) {
      e.count++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((e) => toHex(e.r / e.count, e.g / e.count, e.b / e.count));
}

export async function extractFromUrl(url: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  return await new Promise<string[]>((resolve) => {
    img.onload = () => resolve(extractFromImage(img));
    img.onerror = () => resolve([]);
    img.src = url;
  });
}

function bin(v: number): number {
  return Math.min(BINS_PER_AXIS - 1, Math.floor((v / 256) * BINS_PER_AXIS));
}

function isGrey(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return true;
  return (max - min) / max < SATURATION_FLOOR;
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
```

- [ ] **Step 2: Build the display app**

```bash
npm --workspace display run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add display/src/lib/scene/extractPalette.ts
git commit -m "feat(display): pure pixel-quantizer for image palettes"
```

---

## Task 10: Display reportPalette helper

**Files:**
- Create: `display/src/lib/scene/reportPalette.ts`

- [ ] **Step 1: Write the implementation**

Create `display/src/lib/scene/reportPalette.ts`:

```typescript
/** Tiny network helper for the adaptive-gradient feature. Each widget that
 *  contributes colors (MediaPlayer for album art, Canvas forwarding iframe
 *  reports) calls `reportWidgetPalette(widget.id, colors)`. We POST it
 *  fire-and-forget; the server holds the per-widget map and runs the
 *  reducer. Empty `colors` clears that widget's contribution.
 *
 *  Failures are swallowed: the gradient on screen is unaffected (it just
 *  lags by one push) and the agent sees stale data until the next
 *  successful POST. */

let displayName: string | null = null;

export function setDisplayName(name: string | null): void {
  displayName = name;
}

export function reportWidgetPalette(widgetId: string, colors: string[]): void {
  if (!displayName) return;
  void fetch(`/api/displays/${encodeURIComponent(displayName)}/palette`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ widgetId, colors }),
  }).catch(() => {});
}
```

- [ ] **Step 2: Build**

```bash
npm --workspace display run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add display/src/lib/scene/reportPalette.ts
git commit -m "feat(display): reportWidgetPalette helper"
```

---

## Task 11: Wire `setDisplayName` from the kiosk page

**Files:**
- Modify: `display/src/routes/+page.svelte`

- [ ] **Step 1: Import + call**

In `display/src/routes/+page.svelte`, add to the imports:

```typescript
  import { setDisplayName } from '$lib/scene/reportPalette';
```

Find the `start(n: string)` function:

```typescript
  function start(n: string) {
    name = n;
    socket = connect(n, handleMessage);
  }
```

Replace with:

```typescript
  function start(n: string) {
    name = n;
    setDisplayName(n);
    socket = connect(n, handleMessage);
  }
```

In the `onDestroy` (or a sibling spot near `socket?.close()`), add a clear:

```typescript
  onDestroy(() => {
    socket?.close();
    setDisplayName(null);
  });
```

- [ ] **Step 2: Build**

```bash
npm --workspace display run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add display/src/routes/+page.svelte
git commit -m "feat(display): wire setDisplayName once the display is registered"
```

---

## Task 12: MediaPlayer widget contributes album-art palette

**Files:**
- Modify: `display/src/lib/widgets/MediaPlayer.svelte`

- [ ] **Step 1: Find the existing component**

Read `display/src/lib/widgets/MediaPlayer.svelte` first to find where `data.album_art_url` is used and the script block lives.

- [ ] **Step 2: Add reactive extraction**

In the `<script>` of `MediaPlayer.svelte`, add:

```typescript
  import { onDestroy } from 'svelte';
  import { extractFromUrl } from '$lib/scene/extractPalette';
  import { reportWidgetPalette } from '$lib/scene/reportPalette';

  let lastExtractedUrl: string | null = null;

  // Reactive: when album_art_url changes, extract and report. When it
  // disappears, clear our contribution.
  $: handleArtChange((widget?.data as { album_art_url?: string } | null)?.album_art_url ?? null);

  function handleArtChange(url: string | null) {
    if (!url) {
      if (lastExtractedUrl !== null) {
        lastExtractedUrl = null;
        reportWidgetPalette(widget.id, []);
      }
      return;
    }
    if (url === lastExtractedUrl) return;
    lastExtractedUrl = url;
    void extractFromUrl(url).then((colors) => {
      // Re-check: the URL might have changed again while we were extracting.
      if (lastExtractedUrl !== url) return;
      reportWidgetPalette(widget.id, colors);
    });
  }

  onDestroy(() => {
    if (lastExtractedUrl !== null) reportWidgetPalette(widget.id, []);
  });
```

> If `MediaPlayer.svelte` doesn't already accept `widget` as a prop, this won't apply — read the file first and adapt the property access to its actual prop shape. The contract is: subscribe to whatever holds `album_art_url`, and call `reportWidgetPalette(widgetId, colors)` (with the correct id).

- [ ] **Step 3: Build**

```bash
npm --workspace display run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add display/src/lib/widgets/MediaPlayer.svelte
git commit -m "feat(media-player): extract album art palette and report to server"
```

---

## Task 13: Canvas bridge gains `cosmos.reportColors`

**Files:**
- Modify: `display/src/lib/widgets/canvasBridge.ts`

- [ ] **Step 1: Extend the bridge**

In `display/src/lib/widgets/canvasBridge.ts`, find the `var cosmos = { … }` object inside the bridge script. Add the `reportColors` method alongside `fetch`:

```javascript
    /** Report this canvas's dominant colors back to Cosmos. Feeds the
     *  scene's adaptive gradient when the user has enabled it. Pass an
     *  empty array to clear. Caller can call as often as it likes; the
     *  parent dedupes via the server-side change detector. */
    reportColors: function (colors) {
      if (!Array.isArray(colors)) return;
      try {
        window.parent.postMessage({ type: 'cosmos:report-colors', colors: colors }, '*');
      } catch (e) {}
    },
```

(Place it after the `fetch:` method definition.)

- [ ] **Step 2: Build**

```bash
npm --workspace display run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add display/src/lib/widgets/canvasBridge.ts
git commit -m "feat(canvas-bridge): cosmos.reportColors for adaptive gradient"
```

---

## Task 14: Canvas widget forwards `cosmos:report-colors`

**Files:**
- Modify: `display/src/lib/widgets/Canvas.svelte`

- [ ] **Step 1: Add the import**

In `display/src/lib/widgets/Canvas.svelte` script block:

```typescript
  import { reportWidgetPalette } from '$lib/scene/reportPalette';
```

- [ ] **Step 2: Handle the message**

Find the existing `onMessage` function (it already handles `cosmos:want-entity` and `cosmos:fetch`). Add a third branch:

```typescript
    if (msg.type === 'cosmos:report-colors') {
      const raw = (msg as { colors?: unknown }).colors;
      if (!Array.isArray(raw)) return;
      const colors: string[] = [];
      for (const c of raw) {
        if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) colors.push(c.toLowerCase());
        if (colors.length >= 5) break;
      }
      reportWidgetPalette(widget.id, colors);
      return;
    }
```

- [ ] **Step 3: Clear on unmount**

In the `onDestroy` callback (already present in `Canvas.svelte`), add:

```typescript
    reportWidgetPalette(widget.id, []);
```

- [ ] **Step 4: Build**

```bash
npm --workspace display run build
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add display/src/lib/widgets/Canvas.svelte
git commit -m "feat(canvas): forward cosmos:report-colors to palette helper"
```

---

## Task 15: Display Background type mirrors `adaptive_colors`

**Files:**
- Modify: `display/src/lib/types.ts:3-11`

- [ ] **Step 1: Add the optional flag**

In `display/src/lib/types.ts`, replace the gradient variant of the `Background` type:

```typescript
export type Background =
  | { type: 'solid'; color: string }
  | {
      type: 'gradient';
      colors: string[];
      speed: 'slow' | 'medium' | 'fast';
      style: 'mesh' | 'linear' | 'radial';
      sun_adaptive?: boolean;
      adaptive_colors?: boolean;
    };
```

- [ ] **Step 2: Build display**

```bash
npm --workspace display run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add display/src/lib/types.ts
git commit -m "feat(display): mirror adaptive_colors on the Background type"
```

---

## Task 16: Editor checkbox in the gradient block

**Files:**
- Modify: `display/src/routes/admin/scenes/[id]/+page.svelte`

- [ ] **Step 1: Find the gradient configuration block**

Search for `sun_adaptive` in `display/src/routes/admin/scenes/[id]/+page.svelte`. The new checkbox sits next to it.

- [ ] **Step 2: Add the checkbox**

Right after the existing `sun_adaptive` checkbox row, add:

```svelte
          <Field label="Adapt to widget colors">
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={(scene.background as any).adaptive_colors === true}
                on:change={(e) => {
                  scene.background = { ...scene.background, adaptive_colors: e.currentTarget.checked };
                }}
              />
              <span>Pull live colors from album art and canvas widgets. Falls back to the colors above when nothing is reporting. Stacks with sun-adaptive.</span>
            </label>
          </Field>
```

> Adapt the `scene.background` accessor to whatever variable name the editor uses locally — e.g. if the page binds `let background = scene.background`, mutate `background` and reassign in the same shape the existing `sun_adaptive` checkbox does.

- [ ] **Step 3: Build display**

```bash
npm --workspace display run build
```

Expected: clean build.

- [ ] **Step 4: Smoke check (manual)**

Open `/admin/scenes/<id>` for a gradient-background scene, toggle the new checkbox, save. Reload — the box stays checked. (Persistence comes for free via the existing JSON save path.)

- [ ] **Step 5: Commit**

```bash
git add display/src/routes/admin/scenes/[id]/+page.svelte
git commit -m "feat(editor): adaptive_colors toggle in the gradient block"
```

---

## Task 17: Document `cosmos.reportColors`

**Files:**
- Modify: `docs/canvas-widget-agent.md`
- Modify: `docs/canvas-widget.md`

- [ ] **Step 1: Update the agent contract**

In `docs/canvas-widget-agent.md`, find the JS API code block (search for `cosmos.fetch`). Add right after the `cosmos.fetch` line:

```ts
cosmos.reportColors(colors: string[]): void
```

Then add a short section after the **Outbound fetches** section:

```markdown
### Reporting palette colors (`cosmos.reportColors`)

If your canvas has dominant colors worth contributing to the scene's gradient — say, a glowing accent or a hero image — report them with `cosmos.reportColors([...])`. The user opts the scene into using these via the **Adapt to widget colors** toggle in the gradient block; if they haven't, the call is a harmless no-op as far as visuals go (but the server still records the palette and exposes it via `GET /api/displays/<name>/palette`, so an agent can ask "what colors is the kitchen-wall canvas reporting?").

- Pass 1–5 `#rrggbb` strings. Anything else is dropped.
- Pass `[]` to clear your contribution.
- Call as often as you like; the server's change detector dedupes.

```js
cosmos.reportColors(['#ff8c4d', '#3d2a1f', '#ffd6a8']);
```
```

- [ ] **Step 2: Update the user doc**

In `docs/canvas-widget.md`, find the API table (search for `cosmos.subscribe`). Add a row after `cosmos.fetch`:

```markdown
| `cosmos.reportColors(colors)` | `(colors: string[]) => void` | Contribute up to 5 dominant `#rrggbb` colors to the scene's adaptive gradient. Pass `[]` to clear. Visual effect requires the scene's gradient to have **Adapt to widget colors** enabled; the colors are always recorded server-side regardless. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/canvas-widget-agent.md docs/canvas-widget.md
git commit -m "docs(canvas): document cosmos.reportColors"
```

---

## Task 18: Final verification

- [ ] **Step 1: Full server suite**

```bash
npm --workspace server test
```

Expected: all green; new tests in `palette.test.ts`, `displayPalette.test.ts`, `palette.api.test.ts`, extended `assembler.test.ts` and `agent-tools.test.ts` accounted for.

- [ ] **Step 2: Full build**

```bash
npm run build
```

Expected: clean across `display` + `server`.

- [ ] **Step 3: Manual smoke**

1. `npm run dev:server` and `npm run dev:display`.
2. In the admin, edit a scene with a gradient background. Toggle **Adapt to widget colors** on. Save.
3. Add or use a media_player widget pointed at a real (or mock) HA `media_player.*` entity that has album art.
4. With the kiosk visible, set the entity to playing with a colorful album. Observe the gradient transition to colors derived from the art within ~1 s.
5. From a separate terminal: `curl http://localhost:8099/api/displays/<your-display>/palette` → should return the resolved colors and timestamp.
6. Pause / change to art with no metadata; gradient returns to the user-picked palette on the next push.
7. Optional: in a canvas widget, call `cosmos.reportColors(['#ff0000', '#0000ff'])` from a `<script>` block. Confirm the gradient shifts and the GET endpoint shows those colors.

- [ ] **Step 4: Final repo state**

```bash
git status
git log --oneline origin/dev..HEAD
```

Expected: clean tree, ~17 commits ahead of `origin/dev`.

---

## Self-review notes

1. **Spec coverage:** Every section of `2026-05-08-adaptive-gradient-design.md` maps to at least one task — pure reducer (Task 1), store (Task 2), background flag (Tasks 3 + 15), assembler override (Task 4), REST endpoints (Task 5), WS reactivity + cleanup (Task 6), entrypoint wiring (Task 7), agent tool (Task 8), display extractor + helper (Tasks 9–11), per-widget contributors (Tasks 12 + 13–14), editor (Task 16), docs (Task 17). No spec sections left without a task.
2. **Type consistency:** `displayPalette` exposes `set/getResolved/clearDisplay/pruneWidgets` consistently across tasks. `reportWidgetPalette(widgetId, colors)` matches the bridge usage and the API body. Background gradient gains `adaptive_colors?: boolean` in both server (`store/scenes.ts`) and display (`lib/types.ts`).
3. **No placeholders:** Every step contains real code or a concrete command. Two tasks (12 and 16) note that the agent should adapt to the actual local variable shape of the existing component — both spell out the contract and reference the file to read first.
4. **Testing plan:** Server-side coverage is comprehensive (reducer, store, REST endpoints + change detector, assembler, agent tool). Display-side extractor is intentionally manual-smoke per the existing display test posture in `display/CLAUDE.md`.
