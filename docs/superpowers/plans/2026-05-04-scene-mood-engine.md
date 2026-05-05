# Cosmos Scene Mood Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "mood" layer to scenes — a looping video clip rendered between the background and the widget grid that gives the display ambient depth (drifting clouds, rain, embers, stars, sunrise glow). Videos use a black background and `mix-blend-mode: screen` to composite onto whatever background the scene already has, so any mp4 with bright content on black works.

A scene's mood is configured under three **strategies**:
- `manual` — user picks one mood id, it plays whenever the scene is active.
- `time` — server resolves to one of `sunrise | day | evening | night` from HA's `sun.sun` entity (with a clock-based fallback when HA is disabled), maps that to a bundled mood id.
- `weather` — user picks a weather entity in scene settings; server reads its `state` (sunny / cloudy / rainy / snowy / clear-night / …) and maps to a mood id.

The server resolves the active mood at scene-push time and ships a flat `mood?: { url, blend }` on `SceneState`. The display is dumb: if `state.mood` is present, mount a video element keyed to scene id (so it restarts per scene), otherwise render nothing extra.

**Architecture:**
- New SQLite migration adds a `mood` JSON column to `scenes` (`{enabled, strategy, moodId?, weatherEntity?}`).
- `server/src/moods/catalog.ts` defines the bundled mood library (id, label, file path, tags) and the time/weather strategy mapping tables. `GET /api/moods` exposes the catalog to the admin editor.
- `server/src/moods/resolve.ts` is a pure function: given a scene's mood config + entity reads, returns `{url, blend} | null`.
- `server/src/scenes/assembler.ts` calls the resolver and embeds the result on `SceneState`.
- HA entity reactivity: when `sun.sun` or the scene's weather entity changes, the existing reactive re-push fires automatically (assembler reads through the same entity-cache hook used by widgets). No new subscription plumbing needed.
- Videos live at `display/static/moods/<id>.mp4` so they're served at `/moods/<id>.mp4` by the static handler in dev and prod.
- Display: new `MoodLayer.svelte` component, mounted inside `SceneCanvas` between `<Background>` and the widget grid, rendered with `{#key scene.id}` so it remounts per scene.
- Admin editor: scene editor gets a new "Mood" card with on/off, strategy picker, conditional mood select (manual) or weather entity picker (weather). The `time` strategy needs no extra fields.

**Tech Stack:** Same as Plan 5. No new dependencies.

---

## Common Conventions

- Branch off `main`: `git checkout main && git checkout -b cosmos-mood-engine`.
- TDD: failing test first, observe failure, implement, observe pass, commit.
- Conventional commits: `feat(moods): …`.
- Stage exactly the files each task lists.
- All file content in this plan is verbatim — copy as shown unless noted.

---

## File Structure

New files:

```
display/static/moods/
  README.md                       # video spec + naming convention (commit-friendly placeholder)
  clouds.mp4                      # user-provided
  rain.mp4                        # user-provided
  snow.mp4                        # user-provided
  stars.mp4                       # user-provided
  sunrise.mp4                     # user-provided
  embers.mp4                      # user-provided

server/src/
  moods/
    catalog.ts                    # bundled mood ids + label + file + strategy mappings
    resolve.ts                    # pure resolver: scene config + entity reads → {url, blend} | null
    types.ts                      # MoodConfig + ResolvedMood types
  api/
    moods.ts                      # GET /api/moods returns the catalog

display/src/lib/scene/
  MoodLayer.svelte                # the video element, screen-blended
```

Modified files:

```
server/src/store/migrations.ts    # migration v? — add mood JSON column to scenes
server/src/store/scenes.ts        # mood field on Scene + SceneInput
server/src/scenes/types.ts        # SceneState gets mood?: ResolvedMood
server/src/scenes/assembler.ts    # call resolveMood() and attach to SceneState
server/src/api/http.ts            # register moods route
server/src/api/scenes.ts          # accept mood on POST/PUT
server/src/api/ws.ts              # pass HA client into assembler for sun.sun + weather reads (already does, just confirm)
server/src/index.ts               # wire moods route

display/src/lib/types.ts          # mirror ResolvedMood on SceneState
display/src/lib/scene/SceneCanvas.svelte   # mount <MoodLayer> with {#key scene.id}
display/src/lib/admin/api.ts      # moods.list() helper
display/src/routes/admin/scenes/[id]/+page.svelte  # Mood card in the editor
```

---

## Data shapes

```ts
// server/src/moods/types.ts
export type MoodStrategy = 'manual' | 'time' | 'weather';

export interface MoodConfig {
  enabled: boolean;
  strategy: MoodStrategy;
  moodId?: string;          // required when strategy === 'manual'
  weatherEntity?: string;   // required when strategy === 'weather'
}

export interface ResolvedMood {
  url: string;              // e.g. '/moods/clouds.mp4'
  blend: 'screen' | 'lighten';
}

export interface MoodCatalogEntry {
  id: string;               // 'clouds' | 'rain' | …
  label: string;            // 'Drifting clouds'
  file: string;             // 'clouds.mp4'
  tags: string[];           // ['day', 'sunny'] — used by strategy mappers
}
```

Wire format addition (server → display):
```ts
// SceneState gains:
mood?: { url: string; blend: 'screen' | 'lighten' };
```

`MoodConfig` is stored on the scene row as JSON. Default for new scenes: `{ enabled: false, strategy: 'manual' }`.

---

## Strategy mapping (v1 defaults — bundled in `catalog.ts`)

**Time strategy** — uses `sun.sun` attributes (`next_dawn`, `next_dusk`, `state: above_horizon|below_horizon`) plus `next_rising` / `next_setting` to bucket *now* into one of four periods:
- `sunrise` — within 45min before/after sunrise → mood `sunrise`
- `day` — between sunrise+45min and sunset−45min → mood `clouds`
- `evening` — within 45min before/after sunset → mood `embers`
- `night` — otherwise → mood `stars`

When HA is disabled, fall back to local server time: 5–8 = sunrise, 8–18 = day, 18–21 = evening, 21–5 = night.

**Weather strategy** — reads the configured entity's `state`:
- `sunny | clear` → `clouds`
- `partlycloudy | cloudy` → `clouds`
- `rainy | pouring` → `rain`
- `snowy | snowy-rainy` → `snow`
- `clear-night` → `stars`
- anything else → `clouds`

Both mappings live as exported constants in `catalog.ts` so they're easy to tweak.

---

## Tasks

### Task 1: catalog + resolver + tests
- [ ] Create `server/src/moods/types.ts` with the type defs above.
- [ ] Create `server/src/moods/catalog.ts` with the v1 entries (`clouds`, `rain`, `snow`, `stars`, `sunrise`, `embers`) and the time/weather mapping constants. Each entry's `file` is the bare filename; the `url` is built as `/moods/${file}` at resolve time.
- [ ] Create `server/src/moods/resolve.ts` exporting `resolveMood(config: MoodConfig, ctx: { now: Date; readEntity: (id: string) => EntityState | null }): ResolvedMood | null`. Disabled config → null. Manual → look up `moodId` in catalog. Time → resolve via `sun.sun` (or local time fallback if entity missing). Weather → look up `weatherEntity` and map.
- [ ] Add `server/src/moods/resolve.test.ts` covering: disabled returns null; manual resolves to correct url; manual with unknown id returns null; time uses sun.sun above/below horizon; time falls back to clock when sun.sun missing; weather maps each documented condition; weather with missing entity returns null.
- [ ] Commit: `feat(moods): add mood catalog and resolver with strategy mapping`.

### Task 2: DB migration + Scene model
- [ ] Append a new migration to `server/src/store/migrations.ts` adding `mood TEXT` (JSON) to `scenes`. Default for existing rows: `{"enabled":false,"strategy":"manual"}`.
- [ ] Extend `Scene` and `SceneInput` types in `server/src/store/scenes.ts`. Serialize/deserialize JSON at the repo boundary like other JSON columns.
- [ ] Tests: extend the existing scenes repo test — round-trip a scene with a mood config; default mood for a scene created without one.
- [ ] Commit: `feat(moods): persist mood config on scenes`.

### Task 3: assembler integration
- [ ] Add `mood?: ResolvedMood` to `SceneState` in `server/src/scenes/types.ts`.
- [ ] In `server/src/scenes/assembler.ts`, after building widgets, call `resolveMood(scene.mood, { now: new Date(), readEntity: ha.getEntity })` and attach to the returned state.
- [ ] Test: assembler returns `mood` when scene has enabled manual mood; omits the field when disabled.
- [ ] Commit: `feat(moods): resolve mood at scene assembly time`.

### Task 4: API surface
- [ ] Create `server/src/api/moods.ts` registering `GET /api/moods` returning the catalog as JSON (id, label, tags only — no file paths needed by the admin).
- [ ] Mount it from `server/src/index.ts` and `server/src/api/http.ts`.
- [ ] Update `server/src/api/scenes.ts` POST/PUT validation to accept the `mood` field; reject unknown strategies and unknown mood ids (manual) at the boundary.
- [ ] Tests: GET /api/moods returns the v1 list; POST /api/scenes with valid mood persists; POST with invalid moodId 400s.
- [ ] Commit: `feat(moods): expose moods API and scene field`.

### Task 5: video assets folder
- [ ] Create `display/static/moods/README.md` documenting the contract (filename = catalog id + `.mp4`; black background; H.264; ≥10s loop with seamless start/end; ≤1080p; ≤10MB target). List the v1 ids the user needs to drop in.
- [ ] Add `.gitkeep` if needed so the directory commits even before videos land.
- [ ] No code commit on its own — videos arrive separately.

### Task 6: display rendering
- [ ] Mirror `ResolvedMood` on `SceneState` in `display/src/lib/types.ts`.
- [ ] Create `display/src/lib/scene/MoodLayer.svelte`:
    - Props: `mood: { url; blend }`.
    - Renders `<video src={mood.url} autoplay loop muted playsinline preload="auto" />` absolutely positioned to fill the scene.
    - `mix-blend-mode: var(--cosmos-mood-blend)` driven by the `blend` prop; `pointer-events: none`; `will-change: opacity`.
    - Respects `prefers-reduced-motion`: render the first frame as a poster but pause playback.
- [ ] In `display/src/lib/scene/SceneCanvas.svelte`, mount `{#if scene.mood}{#key scene.id}<MoodLayer mood={scene.mood} />{/key}{/if}` between `<Background>` and the widget layer. Z-index: above background, below widgets.
- [ ] Smoke check via existing Playwright transition test or by hand: load a scene with a manual mood, confirm video plays.
- [ ] Commit: `feat(moods): render mood video layer on display`.

### Task 7: admin editor
- [ ] Add `moods.list()` to `display/src/lib/admin/api.ts`.
- [ ] In `display/src/routes/admin/scenes/[id]/+page.svelte`, add a "Mood" `.card` after the Background card:
    - Toggle: enable mood layer.
    - Strategy: segmented control (`Manual` / `By time of day` / `By weather`).
    - When `manual`: dropdown of catalog entries.
    - When `weather`: entity picker filtered to `weather.*` (reuse the existing entity-picker pattern from EntityTile config).
    - When `time`: brief help text describing the time-of-day mapping.
- [ ] Persist on save via the existing scene PUT.
- [ ] Commit: `feat(moods): mood configuration in scene editor`.

### Task 8: docs + CLAUDE.md updates
- [ ] Update root `CLAUDE.md` "Architecture" section: mention `moods/` module and the `mood` SceneState field.
- [ ] Update `server/CLAUDE.md` and `display/CLAUDE.md` "Layout" sections.
- [ ] Update Roadmap line at bottom of root `CLAUDE.md`.
- [ ] Commit: `docs: document mood engine`.

---

## Out of scope for v1 (carry forward)

- Per-scene opacity slider (current default ≈ full strength via `mix-blend-mode: screen`; the black background is the implicit alpha).
- Cross-fading mood videos when a scene transition runs (mood remounts per scene id; we let the existing scene transition cover it).
- Mood preview thumbnails in the editor dropdown — bundling poster frames adds Docker-image weight; defer until users ask.
- True-alpha (webm VP9-α) support — easy to add later by extending `blend` to `'alpha'` and dropping `mix-blend-mode` for those entries.
- Per-display mood override — moods stay a scene property in v1.

---

## Verification

- All server tests pass: `npm --workspace server test`.
- Admin editor: create a scene, enable mood, pick `clouds`, save, navigate to display, see clouds drifting over background.
- Switch strategy to `time`, confirm correct mood for current local time (or stub `sun.sun` via mock).
- Switch to `weather`, pick a weather entity, change its state in HA dev tools, observe re-push and mood swap within ~1s.
- Reduced-motion: enable OS-level reduce-motion, confirm video pauses on first frame and CPU drops.
- Disabled scene mood: no `<video>` mounted, no network request for `/moods/*.mp4`.
