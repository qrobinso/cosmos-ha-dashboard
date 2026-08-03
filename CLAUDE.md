# Cosmos Dashboard

Wall dashboard for Home Assistant. Two-package npm workspace: a Node/TypeScript server (`server/`) and a SvelteKit static display app (`display/`).

## Quick start

```bash
npm install
npm test                                       # run server test suite
npm run dev                                    # both server + display with HMR — open http://localhost:5173
npm run build                                  # build display + server for production
```

`npm run dev` spawns the Fastify server (`tsx watch`, :8099) and Vite (:5173) under `concurrently`. Develop against `:5173` (Vite proxies `/api` and `/ws` to `:8099`) for Svelte HMR; server-side TS changes auto-restart Node and the kiosk's WS reconnect re-syncs without a full reload. The legacy `npm run dev:server` / `npm run dev:display` scripts still work for split-terminal use.

To run the production server (bundles the built display via @fastify/static):

```bash
npm run build
DB_PATH="$(pwd)/data/cosmos.db" npm --workspace server start
```

## Architecture (current)

- `server/` — Node + TypeScript + Fastify + ws + better-sqlite3. Holds scene config in SQLite; pushes scene state over WebSocket to displays. See `server/CLAUDE.md`.
- `display/` — SvelteKit + adapter-static. Built artifacts at `display/build/` are served by the server. See `display/CLAUDE.md`.
- `transitions/` (server) — built-in transition descriptors + per-scene-pair overrides. Server resolves which transition applies on each scene activation; client runs the choreography.
- `ha/` (server) — HA websocket client. Subscribes to `state_changed`, maintains an in-memory entity cache, fires reactive scene re-pushes when an active scene's widgets read an entity that changes.
- `mqtt/` (server) — MQTT client + HA discovery payload builder + command parser. Optional; degrades gracefully when `MQTT_URL` is unset.
- `overlay/` (server) — `OverlayMessage` type + WS push helpers (`pushOverlayTo`, `dismissOverlayFor`, …) for the toast/banner primitive.
- `moods/` (server) — Scene Mood Engine: bundled video catalog + pure resolver (`MoodConfig` + strategy `manual | time | weather` → `{url, blend}`). Time strategy reads HA's `sun.sun`; weather strategy reads a user-picked `weather.*` entity. Resolved mood ships on `SceneState.resolvedMood`; the display mounts it as a screen-blended `<video>` between the background and widget grid. Videos live at `display/static/moods/<id>.mp4` and ship with the app Docker image.
- `addon/` — Home Assistant app packaging in a subdirectory (HA Supervisor requires the multi-addon repo layout: `repository.yaml` at root + each addon in its own subdir). Contains `config.yaml`, `Dockerfile`, `run.sh`, `build.yaml`, `DOCS.md` / `CHANGELOG.md` / `translations/en.yaml`. **Build context constraint:** Supervisor pins the Docker context to `addon/`, but the actual app source lives at the repo root. The Dockerfile sidesteps this by `git clone`-ing the source from GitHub (`BUILD_REF` arg in `build.yaml`, defaults to `main`) instead of using local COPYs. Bump `version:` in `config.yaml` (and optionally `BUILD_REF` for reproducibility) to push an update. Users install by adding `https://github.com/qrobinso/cosmos-ha-dashboard` to **Settings → Apps → Repositories**.
- `calendar` widget — multi-source calendar with five views (agenda / month / week / day / lanes) dispatched by a thin shell at `display/src/lib/widgets/Calendar.svelte`. View components and shared layout helpers (`eventLayout.ts` for overlap-aware column packing + now-line math) live under `display/src/lib/widgets/calendar/`. Sources are colored by a fixed palette (`display/src/lib/admin/widgets/calendarPalette.ts`); time grids render a now-line indicator. Server-side `normalizeCalendarSources` in the assembler accepts legacy single-entity configs.
- `canvas` widget — sandboxed iframe (`sandbox="allow-scripts"`) running user/agent-authored HTML/CSS/JS. Templates inside the content (`{{ states("...") }}`) are rendered server-side by HA via the `render_template` WS subscription (pin-for-pin HA-compatible). The iframe gets a small read-only postMessage bridge exposing `window.cosmos.{entity, subscribe, getCalendarEvents, fetch, reportColors, size, scene, font, tokens, ready}` plus CSS variables (`--cosmos-font-family`, `--cosmos-font-scale`, `--cosmos-bg`, `--cosmos-fg`, `--cosmos-w/h`). See `docs/canvas-widget.md` (user) and `docs/canvas-widget-agent.md` (LLM contract).
- Agent contracts: `docs/scene-agent.md` (how an LLM produces a `POST /api/scenes` payload, layout/background/typography best practices, publishing flow) pairs with `docs/canvas-widget-agent.md` for the inside-the-iframe contract.
- `mcp/` (server) — Optional Model Context Protocol HTTP server at `/mcp` so external agents (Claude Desktop, Cursor, etc.) can call Cosmos's tools. Bearer-token-gated, off by default. Same `app.inject(...)` execution path as the in-product agent. See `docs/superpowers/specs/2026-05-07-mcp-server-design.md`.
- `voice/` (server) — Voice Assistant relay: a second, dedicated HA websocket connection (`client.ts`) drives `assist_pipeline/run` (stt → intent → tts) fed by base64 PCM chunks the display streams over the main WS; `relay.ts` wraps that per-utterance run with error handling and a hard timeout so a wedged HA can't hang a turn forever. Flow: kiosk wake-word detector fires → kiosk arms mic capture and streams `voice_audio` frames → server buffers per-socket until `final:true` → relay runs the HA pipeline and pushes `voice_result` events (stt-end/intent-end/tts-end/error) back to the display, which drives the overlay and plays the TTS response. `ha-assist.ts` exposes the pipeline list for the admin picker.
- `musicvideo/` (server) — Resolves the YouTube music video for a `media_player`'s current track. `trackKey.ts` normalizes `artist|title` (stripping `feat.` / remaster decoration) into a cache key; `ytdlp.ts` shells out to `yt-dlp -f 18 -j ytsearch1:…` behind a `VideoLookup` interface (the only file that knows yt-dlp exists — swap in a YouTube Data API client by writing one new implementation); `cache.ts` is a two-tier SQLite cache (durable `trackKey → videoId`, ephemeral 4h `videoId → streamUrl`, 24h negative results); `resolver.ts` mirrors `createCanvasResolver`'s lifecycle and **never blocks the scene push** — a cache miss returns `null` immediately and fires `onUpdate` → `markDisplayDirty` → re-push once the lookup lands. The kiosk plays the stream from `/api/musicvideo/stream/:videoId`, never a raw googlevideo URL.

WebSocket protocol (server → display):
- `{type: 'welcome', displayId, message}` — sent on hello.
- `{type: 'scene', state: SceneState, transition?: TransitionDescriptor}` — sent on hello (without transition) and whenever the active scene changes (with transition resolved by the server).
- `{type: 'error', error}` — error reporting.
- `{type: 'overlay', overlay: OverlayMessage}` — push a banner to the display.
- `{type: 'overlay_dismiss'}` — clear any visible banner.
- `{type: 'display_config', config}` — orientation + voice settings, sent on hello and whenever an admin changes them for a connected display.
- `{type: 'voice_result', stage, text?, audioUrl?, error?}` — one Assist pipeline event (`listening | stt-end | intent-end | tts-end | error`); `audioUrl` is already proxied through the ha-media convention by the time it reaches the display.

WebSocket protocol (display → server): `{type: 'voice_audio', seq, chunk, final}` (base64 PCM frame) and `{type: 'voice_health', mic}` (kiosk-reported mic/model status), alongside the existing `{type: 'hello', displayName}`.

REST highlights:
- `POST /api/displays/register {name}` — register/find a display.
- `GET /api/displays` — list displays.
- `POST /api/scenes` / `GET /api/scenes` / `GET /api/scenes/:id` / `PUT /api/scenes/:id` / `DELETE /api/scenes/:id` — scene CRUD.
- `GET /api/scenes/:id/preview` — assembled `SceneState` (no transition) for the admin editor's read-only scene preview. Uses the stateless data resolvers when HA is connected (mock otherwise); skips the stateful canvas resolver.
- `POST /api/displays/:name/assign-scene {sceneId, makeDefault?}` — assign a scene to a display.
- `GET /api/settings/safe-area` / `PUT /api/settings/safe-area {top,right,bottom,left}` — global safe-area padding.
- `POST /api/displays/:name/scene/activate {sceneId, transitionId?}` — set the active scene with optional explicit transition override.
- `GET /api/transitions` / `GET /api/transitions/:id` — list/get transitions.
- `GET /api/ha/entities[?domain=light]` — list cached HA entities (or mock entities when HA disabled).
- `GET /api/moods` — list bundled moods (id, label, tags) for the editor's Mood card.
- `GET /api/ha/assist-pipelines` — list HA Assist pipelines (empty array when the voice client is unavailable) for the admin voice picker.
- `PUT /api/displays/:name/voice {enabled, pipelineId}` — toggle voice + pick a pipeline for a display; notifies a connected kiosk live via `display_config`.
- `GET /api/musicvideo/stream/:videoId` — proxies the YouTube progressive MP4 to the kiosk, forwarding `Range` and re-deriving expired stream URLs server-side.

Optional env vars: `HA_URL` + `HA_TOKEN` enable HA integration; `MQTT_URL` enables MQTT command dispatch + HA discovery. Without them, Cosmos uses mock entity data and overlay commands are unavailable.

## Where to look

- `docs/superpowers/plans/` — implementation plans (Plan 1 = Foundation, Plan 2 = Scenes & widgets, future plans coming).
- `docs/superpowers/specs/` — design specs (currently embedded inside the plans; standalone specs may land later).

## Conventions

- TDD: write the failing test first, run it and observe failure, implement, observe pass, then commit.
- Conventional commits: `feat|fix|chore|refactor(scope): subject`.
- Frequent small commits; each task in a plan is its own commit.
- Modules have one job; files stay focused enough to hold in context at once.
- Never modify Plan 1 / Plan 2 plan files retroactively; if a plan is wrong, surface it as a deviation in the implementer's report.

## Design

Two distinct surfaces with separate visual languages:

- **Kiosk** (`/`, the wall display) — calm and beautiful. CSS-driven animated gradient backgrounds, bundled `@fontsource` typography (Inter, Fraunces, JetBrains Mono, Space Grotesk), per-scene typography + scale, transition engine with 6 built-ins, message overlays. Designed to be glanceable from across a room and gorgeous mid-transition.
- **Admin** (`/admin/*`) — modern, simple, mobile + desktop friendly. Lives under a `.cosmos-admin` ancestor class and pulls all styling from `display/src/lib/admin/theme.css`. Calm dark surfaces, single warm accent (`--c-accent`), Inter for UI + JetBrains Mono for data, 44px touch targets, hamburger nav <720px and pill nav ≥720px, hairline borders, motion via `cubic-bezier(0.2, 0.8, 0.2, 1)`. See `display/CLAUDE.md` § "Admin design system" for the full token list.

When adding admin pages: use the existing `.cosmos-admin` shell, the `eyebrow` + `h1` page-header pattern, `.card` surfaces, `.tag` pills for metadata, and theme CSS variables — never hardcode colors. Stack on mobile by default and broaden at the existing 600px / 720px breakpoints.

## Known tech debt (carry forward)

- `displays.registerByName` has a SELECT-then-INSERT race — fine at single-user scale, fix when concurrent reconnections become a thing.
- `scenes` repo `list()` and `listAssignedTo()` do N+1 widget queries — fine at < ~10 scenes.
- Widget input is validated at the API boundary for *shape* (kind ∈ `WIDGET_KINDS`, position is in-bounds integers, config is an object, entity-bearing kinds have a syntactically valid `entity_id`) — see `validateWidget` in `server/src/api/scenes.ts`. Per-kind `config` *contents* beyond `entity_id` are still unvalidated (any extra JSON is accepted and passed through). Tighten per-kind config if a malformed-config bug surfaces.
- `Fastify({logger: false})` is hardcoded — wire to config when production logging matters.
- Scene `font_family` strings are matched to CSS variables by stripping spaces (`'Space Grotesk'` → `--cosmos-font-SpaceGrotesk`). Nothing enforces consistency between DB values and CSS variable names. Plan 5's editor UI should validate against an enum (or store a canonical key + map).
- `Weather.svelte` hardcodes `grid-template-columns: repeat(5, 1fr)` for the forecast row. The mock data is always 5 days, but `WeatherForecastDay[]` has no length constraint. Loosen to `repeat(auto-fill, minmax(...))` or pin the type when Plan 4 wires real HA data.
- `display/src/lib/ws.ts` reports `error`/`close` but does not retry. **(Plan 3 fixed: now reconnects with exponential backoff capped at 30s.)**
- `TransitionStage` skips `controller.receive` when the new scene has the same id as the previously rendered scene. On reconnect or REST PUT to the active scene, updated widget data is silently dropped. Will hurt once Plan 4's HA-driven widget data updates start flowing.
- `bridge.background_morph` in transition descriptors currently only extends bridge-phase duration; it does not drive true CSS color interpolation between gradient palettes (the layered cross-fade reads as a morph but isn't one). Either rename the flag or implement true interpolation in Plan 5.
- `stagger_ms` is part of `TransitionPhase` types but the CSS only animates the whole stage layer, not per-widget. Implement widget-level stagger or remove the field before Plan 5.
- Built-in transition descriptors live only inside the migration SQL string; if Plan 5 needs to expose or test them as a constant, extract to `server/src/transitions/builtins.ts`.
- `assemblePush` is currently synchronous. Plan 4 will need to make it `async` for HA reads — beware of the rapid-fire scene-change race on `lastSceneByDisplay` once `buildPayload` becomes async.
- Calendar week-start-day, hour-range window, and color palette are all hardcoded (Sunday start, 6am–11pm, 8-color `CALENDAR_SOURCE_PALETTE` in `display/src/lib/admin/widgets/calendarPalette.ts`). Surface in the editor if users want it.
- Calendar `defaultConfig` still emits `entity_id`-free configs; the editor's lazy promotion handles legacy scenes, and direct `POST /api/scenes` calls with the legacy single-entity shape still work thanks to the assembler's `normalizeCalendarSources`. Could tighten the schema later.
- Calendar reactive re-push on event mutation still TODO — HA doesn't fire `state_changed` for calendar event mutations, so changes only land on the next scene push. Carry into a future plan.
- `createVoiceRelay`'s `runUtterance` wraps the whole HA iteration in one try/catch around `onResult` calls — an exception thrown *by* an `onResult` callback (e.g. a bug in the WS push path) is caught and reported as a pipeline error rather than propagating, which could mask a bug in the caller.
- Multi-chunk voice-audio buffering (more than one non-final `voice_audio` frame before `final:true`) and the voiceRelay-absent code paths in `api/ws.ts` are exercised only lightly by tests — worth dedicated coverage before this sees heavier real-world traffic.
- `lastVoiceHealthByDisplay` (in `api/ws.ts`) is never pruned when a display disconnects, so it grows unbounded across the lifetime of the process for churny display names. Low risk at real-world display counts; revisit if that changes.
- The `voice_audio` chunk's base64 encode (kiosk) → decode (server) round trip has no dedicated test asserting byte-for-byte fidelity.
- `wakeword.ts`'s ONNX tensor names (`'input'`/`'output'`) are placeholders — the real `.onnx` wake-word model is a build asset **not checked into this repo** (like the mood `.mp4` clips). Whoever adds that asset must verify the names against the model's actual `session.inputNames`/`session.outputNames` and adjust if they differ.
- The kiosk's reported mic health is typed as a bare `string | null` in the admin displays page rather than the shared `VoiceHealth` union — drifts silently if the union gains/renames a member.
- The voice overlay (listening/thinking/response/error) reuses the kiosk's single `MessageOverlay` slot rather than a dedicated voice UI — a voice state and a server-pushed `OverlayMessage` can't show simultaneously; whichever lands last wins.
- `display` has no wired typecheck script and `svelte-check` currently reports pre-existing errors unrelated to voice — worth a follow-up pass to get it clean and wired into CI.
- `voice/relay.ts`'s per-utterance timeout `break`s out of the loop without calling `iterator.return()`, so on the rare "HA sent run-start then went silent >30s" path the parked generator (HA subscription + up to 2MB of buffered audio) stays reachable until process exit. Add `iterator.return?.()` on the timeout path.
- `music_video_cache` is never pruned. Bounded in practice by distinct tracks played, but it grows for the life of the DB — add a pruning pass if it gets large.
- Music video lookups are skipped for non-music `media_content_type` values (`tvshow`, `episode`, `movie`, `video`, `game`, `app`, `url`) via a denylist in `assembler.ts`, since a TV episode reports title/artist too. Integrations reporting no content type still get a lookup. If a player reports an unusual type for music, add it to the allowed side.
- Music video candidate scoring weights track-duration match above everything else, deliberately: it will prefer a length-matching **live** official video over a shorter official studio video (real case: Bowie's 6:11 album "Heroes" picks the 6:04 live cut over the 3:29 studio video). Chosen so the video doesn't visibly loop mid-song. Flip it by softening the duration bands in `musicvideo/score.ts` and raising the official-video bonus; the Solange fixture test is the regression guard.
- Music video match quality is otherwise bounded by what YouTube surfaces in the top 5. Scoring rejects the obvious wrong answers (lyric videos, covers, remixes, karaoke) but an unusually-titled upload can still win. `LOG_MUSICVIDEO=1` prints the scored candidate table; the widget's `query_suffix` is the per-widget tuning knob.
- `yt-dlp` is against YouTube's ToS and its extractors break when YouTube changes; a broken extractor degrades to a permanently hidden widget with no user-visible explanation. Requires occasional `yt-dlp -U` (the app image installs the upstream musl standalone build precisely so self-update works — an `apk`-managed copy cannot self-update). The pinned `YTDLP_VERSION` in `addon/Dockerfile` also goes stale between releases; bump it alongside the addon version. Deliberate, accepted tradeoff — see `docs/superpowers/specs/2026-08-02-music-video-widget-design.md`.
- The music video widget's position sync wraps `position % videoDuration`, so a video shorter than the track restarts at an arbitrary offset rather than at a musically sensible point.
- `MediaPlayer.svelte` still advances its progress bar from push-arrival time rather than HA's `media_position_updated_at` (which `MusicVideo.svelte` now uses). Since many integrations never tick `media_position`, the bar drifts forward on every unrelated scene re-push. Cosmetic only — no seeking involved — so it was left alone; fix by reading `position_updated_at` off `MediaPlayerData` the same way.
- `MusicVideoConfig.svelte` offers a "Name override" field that `MusicVideo.svelte` never renders (the widget is a bare `<video>`). Either drop the field or render a label.
- `voice/client.ts`: if HA rejects a run with an `error` event and never sends `run-start`, the caller sees the generic "run-start timed out" message after the 10s wait instead of HA's actual error immediately — cosmetic, but worth short-circuiting the run-start wait when a terminal error event arrives first.

## Roadmap

- Plan 3: ✅ Shipped — transition engine with 6 built-ins + per-scene defaults + explicit overrides.
- Plan 4: ✅ Shipped — HA + MQTT integration with reactive entity-driven scene push, MQTT discovery + command topics, message overlay primitive.
- Plan 5: ✅ Shipped — admin editor at `/admin` for scenes, displays, settings. Iframe-friendly for HA sidebar panel mounting in Plan 6.
- Plan 6: ✅ Shipped — installable HA app (formerly called "add-on") with Supervisor auto-discovery, Ingress sidebar panel, multi-arch Docker images.
- Plan 7: 🛠 In progress — Scene Mood Engine. Looping video atmosphere layer per scene. Strategies: manual, time-of-day (sun.sun), weather. See `docs/superpowers/plans/2026-05-04-scene-mood-engine.md`.
- Plan A (Calendar v2): ✅ Shipped — multi-source calendar widget with five views (agenda/month/week/day/lanes), per-source color coding, now-line indicator on time grids. See `docs/superpowers/plans/2026-05-17-calendar-v2-data-and-views.md`.
- Plan B (Music Video): ✅ Shipped — `musicvideo` widget resolving YouTube videos for the current track. See `docs/superpowers/plans/2026-08-02-music-video-widget.md`.
