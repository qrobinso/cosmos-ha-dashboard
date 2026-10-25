# Lyrics Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `lyrics` widget that shows LRCLIB lyrics for a media_player's current track in one of four styles (spotlight / karaoke / poster / drift).

**Architecture:** New `server/src/lyrics/` module mirrors `musicvideo/`: pure LRC parser, LRCLIB client behind an injectable fetch, SQLite cache, synchronous never-blocking resolver that re-pushes via `onUpdate`. Assembler ships parsed lines plus a server-extrapolated position. Display: `Lyrics.svelte` shell owns a rAF clock anchored to push arrival, dispatching to four style components.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, vitest (server); SvelteKit + Svelte 4, vitest/jsdom (display).

**Spec:** `docs/superpowers/specs/2026-10-25-lyrics-widget-design.md`

## Global Constraints

- LRCLIB base `https://lrclib.net`; `User-Agent: Cosmos Dashboard (https://github.com/qrobinso/cosmos-ha-dashboard)`; 8 s timeout.
- Duration match tolerance 3 s; known duration with no match ⇒ not found.
- Negative cache TTL 24 h; network errors never cached; positive rows capped (oldest first).
- Gap threshold 5 s; plain-lyrics fallback 4 s/line when duration unknown.
- Config: `entity_id`, `style` (default `spotlight`), `accent?`, `offset_ms` (default 0, positive = lyrics earlier).
- Widget hidden (renders nothing) whenever `lines` is null.
- Motion via transform / opacity / clip-path only.

## Review Focus

1. Player paused mid-song → position must freeze, not run on (timing tests in Task 6).
2. Track change while a lookup is in flight → old lyrics must not flash under the new track (resolver keys by track key; assembler returns `lines:null` on miss — Task 3/4 tests).
3. Seek backwards (position decreases) → current line jumps back, not stuck (timing `currentIndex` is a pure function of position — Task 6 test).
4. LRC with all empty lines / only metadata → treated as no synced lyrics, falls back to plain or hidden (Task 1 test).
5. Title with decoration "(Remastered 2011)" → lookup uses cleaned title (Task 2 test).

---

### Task 1: LRC parser + chorus detection

**Files:** Create `server/src/lyrics/parse.ts`; Test `server/test/lyrics.parse.test.ts`

**Produces:**
- `type LyricsLine = { t?: number; text: string; chorus?: boolean }`
- `parseLrc(lrc: string): LyricsLine[]` — sorted by `t`, metadata tags dropped, `[offset:+ms]` applied (positive offset ⇒ subtract from times, per LRC convention), multiple timestamps on one line expand, `<mm:ss.xx>` word tags stripped, empty-text lines dropped (they mark gaps; the gap is implied by the next timestamp).
- `parsePlain(text: string): LyricsLine[]` — non-blank lines, no `t`.
- `markChorus(lines: LyricsLine[]): LyricsLine[]` — `chorus: true` when normalized text (lowercase, punctuation stripped, whitespace collapsed) occurs ≥2 times.

- [ ] Tests: `[00:12.34]a` → t 12.34; `[01:02]b` → 62; `[00:01.234]` 3-digit ms; `[00:05.00][00:30.00]x` → two lines; `[ar:Foo]` ignored; `[offset:500]` shifts −0.5 s; `<00:01.00>word` stripped; `[00:09.00]` (empty) dropped; metadata-only LRC → `[]`; chorus: "We were gold!" ×2 flagged, unique line not.
- [ ] Run fails → implement → passes → commit `feat(lyrics): LRC parser with chorus detection`.

### Task 2: LRCLIB client

**Files:** Create `server/src/lyrics/lrclib.ts`; Test `server/test/lyrics.lrclib.test.ts`

**Produces:**
- `type LyricsResult = { synced: string | null; plain: string | null; instrumental: boolean }`
- `type LyricsFetch = { get(q: { artist: string; title: string; durationSec?: number }): Promise<LyricsResult | null> }` — null = not found; throws on network/5xx.
- `createLrclibClient(opts?: { fetch?: typeof fetch; baseUrl?: string }): LyricsFetch`
- `cleanTitle(s: string): string` — strip `feat.`, remaster/version, `- Live` decoration. Export the `clean` helper from `musicvideo/trackKey.ts` as `cleanTrackPart` without lowercasing changes in behavior; add `live` to its VERSION alternatives only if no musicvideo test breaks, else handle `- Live` locally.

- [ ] Tests with a fake fetch recording URLs: `/api/get` hit returns fields; 404 on get → `/api/search` used; search picks first result within 3 s of duration; none within 3 s → null; no duration → first result; 500 → throws; `instrumental:true` passed through; query uses cleaned title for `"Heroes (Remastered 2011)"`; sends the User-Agent header.
- [ ] Implement (`AbortSignal.timeout(8000)`), pass, commit `feat(lyrics): LRCLIB client`.

### Task 3: Cache (migration v16) + resolver

**Files:** Modify `server/src/store/migrations.ts` (v16); Create `server/src/lyrics/cache.ts`, `server/src/lyrics/resolver.ts`; Test `server/test/lyrics.cache.test.ts`, `server/test/lyrics.resolver.test.ts`

Migration v16:
```sql
CREATE TABLE lyrics_cache (
  track_key    TEXT PRIMARY KEY,
  synced       TEXT,
  plain        TEXT,
  instrumental INTEGER NOT NULL DEFAULT 0,
  miss         INTEGER NOT NULL DEFAULT 0,
  fetched_at   INTEGER NOT NULL
);
```

**Produces:**
- `createLyricsCache(db, opts?: { now?: () => number }): LyricsCache` with `get(key): { result: LyricsResult | null } | null` (outer null = not cached/expired miss; `result:null` = cached miss), `put(key, result: LyricsResult | null)`, `prune(): number`. `LYRICS_NEGATIVE_TTL_MS = 24h`, `LYRICS_MAX_ROWS = 5000`.
- `createLyricsResolver(fetcher: LyricsFetch, cache: LyricsCache, onUpdate: (widgetId: string) => void): LyricsResolver` where `LyricsResolver = ((widgetId, track: { artist?: string; title?: string; durationSec?: number }) => { lines: LyricsLine[] | null; synced: boolean; trackKey: string | null }) & { dispose(widgetId?: string): void; gc(live: Iterable<string>): void }`. Key via `normalizeTrackKey`. Hit: synced→`markChorus(parseLrc)` (if that yields `[]`, fall back to plain); plain→`markChorus(parsePlain)`; instrumental or miss → `lines:null`. Miss: start deduped fetch (`MAX_CONCURRENT_LYRICS_LOOKUPS = 2`, drop beyond), on settle put + notify live waiters. Thrown errors: don't cache, notify nothing. Memoize parsed lines per key (Map, last 20) so a re-push doesn't reparse.

- [ ] Cache tests: put/get hit; miss returned within TTL, absent after 24h; prune drops expired misses + caps rows.
- [ ] Resolver tests: miss returns null immediately and calls fetch once for two widgets on same track; onUpdate fires for both after settle; second call returns lines; error → no cache row, next call refetches; disposed widget not notified; instrumental → null; empty-synced falls back to plain.
- [ ] Implement, pass, commit `feat(lyrics): cache and non-blocking resolver`.

### Task 4: Assembler + kind registration

**Files:** Modify `server/src/store/scenes.ts` (WIDGET_KINDS += `'lyrics'`), `server/src/api/scenes.ts` (ENTITY_BEARING_KINDS), `server/src/scenes/types.ts` (`LyricsData`, add to `WidgetData`), `server/src/scenes/assembler.ts` (`lyricsResolver?` on DataResolvers; `case 'lyrics'`); Test `server/test/lyrics.assembler.test.ts`

`LyricsData = { entity_id; state; lines: LyricsLine[] | null; synced: boolean; position?: number; duration?: number; track_key?: string }`.
`position` = `media_position + (now − Date.parse(media_position_updated_at))/1000` when `state === 'playing'` and stamp parses, else `media_position`; clamped to `[0, duration]`. Hidden (`lines:null`) for missing entity, non-active state (`MV_ACTIVE_STATES`), `MV_NON_MUSIC_TYPES`, or no resolver.

- [ ] Tests: playing entity with stamp 10 s ago and position 42 → position ≈ 52; paused → 42; tvshow content type → lines null and resolver not called; resolver lines surfaced with synced + track_key; no resolver → lines null.
- [ ] Implement, pass; `grep -rn "'musicvideo'" server/src` for other exhaustive switches and add `lyrics`; commit `feat(lyrics): assemble lyrics widget data`.

### Task 5: Server wiring

**Files:** Modify `server/src/index.ts`, `server/src/api/ws.ts`

- Construct `createLyricsCache(db)`, `createLrclibClient()`, `createLyricsResolver(...)` with the same display fan-out `onUpdate` as musicVideoResolver; pass `lyricsResolver` through ws deps into `buildSceneState`; add `lyrics` widgets to `gcCanvasResolver`'s gc pass; prune lyrics cache in the existing hourly prune; dispose on shutdown.
- [ ] `npm --workspace server run build` passes; full server suite passes (see CLAUDE.md note on exit 139); commit `feat(lyrics): wire resolver into scene push`.

### Task 6: Display timing helpers

**Files:** Create `display/src/lib/widgets/lyrics/timing.ts`; Test `display/src/lib/widgets/lyrics/timing.test.ts`; Modify `display/src/lib/types.ts` (`'lyrics'` kind, `LyricsLine`, `LyricsData`, WidgetData union)

**Produces:**
- `livePosition(pushed: number, anchorMs: number, nowMs: number, playing: boolean, offsetMs: number): number` — pushed + elapsed (if playing) + offset/1000.
- `currentIndex(lines: LyricsLine[], pos: number): number` — last line with `t <= pos`, −1 before first.
- `lineProgress(lines, i, pos, duration?): number` 0..1 between `t[i]` and `t[i+1]` (last line ends at duration or t+5).
- `inGap(lines, pos): boolean` — before first line when `t[0] > 5`, or ≥5 s since current line start with ≥5 s until next... precisely: `pos < t[0] && t[0] - pos > 1` when `t[0] > 5`; or next exists and `t[next] - t[i] > 10` and `pos - t[i] > 5` (line shown ~5 s then gap).
- `plainIndex(count, pos, duration?): number` — even pacing over duration, else 4 s/line; clamped.

- [ ] Tests for each, including pause (playing=false ⇒ no elapsed), seek-back, before-first-line, last line progress.
- [ ] Implement, pass, commit `feat(lyrics): display timing helpers`.

### Task 7: Lyrics widget + four styles

**Files:** Create `display/src/lib/widgets/Lyrics.svelte`, `display/src/lib/widgets/lyrics/{Spotlight,Karaoke,Poster,Drift}.svelte`, `display/src/lib/widgets/lyrics/poster.ts` (pure recipe picker); Modify `display/src/lib/scene/SceneCanvas.svelte`, `display/src/lib/scene/WidgetSlot.svelte` (exclude from slot mask); Test `display/src/lib/widgets/Lyrics.test.ts`

Shell: on each new `data` object, `anchorMs = performance.now()`, `pushed = data.position ?? 0`. rAF loop updates `pos` (stopped on destroy and when not playing). Derives `index`, `progress`, `gap` and passes them + `lines`, `synced`, `accent` (config.accent or `currentColor`-derived default) as props to the style component. Renders nothing when `lines` is null/empty. Style children receive `{ lines, index, progress, gap, synced, accent }` only.

- Spotlight: one list, `transform: translateY` to center `index`; active line opacity 1 + scale 1.08, others .35; chorus tint; top/bottom mask; plain mode = same with index from `plainIndex`, no active emphasis.
- Karaoke: current line + next; fill layer `clip-path: inset(0 calc((1 - var(--p)) * 100%) 0 0)`; plain mode: no fill.
- Poster: `posterRecipe(text: string, index: number): { parts: { text: string; cls: 'big' | 'serif' | 'mono' | 'plain' }[] }` deterministic from a string hash; keyed `{#key index}` with in/out transition (blur+scale).
- Drift: up to 3 most recent lines, positions from `hash(text+index)` in 10–70% bounds, CSS keyframe fade-up-dissolve.
- Gap: Spotlight/Karaoke show `♪ ♪ ♪` pulse.

- [ ] Tests: renders nothing with `lines:null`; each style mounts with fixture data and shows the current line text; `posterRecipe` deterministic (same input → same output) and covers all words.
- [ ] Implement, pass, commit `feat(lyrics): kiosk lyrics widget with four styles`.

### Task 8: Admin editor + docs

**Files:** Create `display/src/lib/admin/widgets/LyricsConfig.svelte`; Modify `display/src/lib/admin/widgets/index.ts`, `display/src/lib/admin/widgetKinds.ts`, `display/src/lib/admin/widgetIcons.ts`, `docs/scene-agent.md`, `CLAUDE.md`

- Kind meta: label `Lyrics`, category `ha`, blurb "Shows the words to the current track, in time with the music.", defaultSize `{w:6,h:4}`, defaultConfig `{ entity_id: firstEntityOfDomain(entities,'media_player'), style:'spotlight', offset_ms:0 }`.
- Config: Media player (EntityPicker), Style select (Spotlight / Karaoke / Poster / Drift), Accent colour (text input + reset; empty = scene default), Sync offset (number, step 100, ms).
- Docs: scene-agent.md section for `lyrics`; CLAUDE.md architecture bullet + known-debt lines.
- [ ] display test suite passes; `npm run build` passes; commit `feat(lyrics): editor config and docs`.
