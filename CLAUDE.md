# Cosmos Dashboard

Wall dashboard for Home Assistant. Two-package npm workspace: a Node/TypeScript server (`server/`) and a SvelteKit static display app (`display/`).

## Quick start

```bash
npm install
npm test                                       # run server test suite
npm run dev:server                             # http://localhost:8099
npm run dev:display                            # http://localhost:5173 (proxies /api + /ws to 8099)
npm run build                                  # build display + server for production
```

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
- `canvas` widget — sandboxed iframe (`sandbox="allow-scripts"`) running user/agent-authored HTML/CSS/JS. Templates inside the content (`{{ states("...") }}`) are rendered server-side by HA via the `render_template` WS subscription (pin-for-pin HA-compatible). The iframe gets a small read-only postMessage bridge exposing `window.cosmos.{entity, subscribe, size, scene, font, tokens, ready}` plus CSS variables (`--cosmos-font-family`, `--cosmos-font-scale`, `--cosmos-bg`, `--cosmos-w/h`). See `docs/canvas-widget.md` (user) and `docs/canvas-widget-agent.md` (LLM contract).
- Agent contracts: `docs/scene-agent.md` (how an LLM produces a `POST /api/scenes` payload, layout/background/typography best practices, publishing flow) pairs with `docs/canvas-widget-agent.md` for the inside-the-iframe contract.

WebSocket protocol (server → display):
- `{type: 'welcome', displayId, message}` — sent on hello.
- `{type: 'scene', state: SceneState, transition?: TransitionDescriptor}` — sent on hello (without transition) and whenever the active scene changes (with transition resolved by the server).
- `{type: 'error', error}` — error reporting.
- `{type: 'overlay', overlay: OverlayMessage}` — push a banner to the display.
- `{type: 'overlay_dismiss'}` — clear any visible banner.

REST highlights:
- `POST /api/displays/register {name}` — register/find a display.
- `GET /api/displays` — list displays.
- `POST /api/scenes` / `GET /api/scenes` / `GET /api/scenes/:id` / `PUT /api/scenes/:id` / `DELETE /api/scenes/:id` — scene CRUD.
- `POST /api/displays/:name/assign-scene {sceneId, makeDefault?}` — assign a scene to a display.
- `GET /api/settings/safe-area` / `PUT /api/settings/safe-area {top,right,bottom,left}` — global safe-area padding.
- `POST /api/displays/:name/scene/activate {sceneId, transitionId?}` — set the active scene with optional explicit transition override.
- `GET /api/transitions` / `GET /api/transitions/:id` — list/get transitions.
- `GET /api/ha/entities[?domain=light]` — list cached HA entities (or mock entities when HA disabled).
- `GET /api/moods` — list bundled moods (id, label, tags) for the editor's Mood card.

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
- Widget input is not validated at the API layer (any JSON shape is accepted). Validation belongs at the API boundary; add when an editor UI lands (Plan 5).
- `Fastify({logger: false})` is hardcoded — wire to config when production logging matters.
- Scene `font_family` strings are matched to CSS variables by stripping spaces (`'Space Grotesk'` → `--cosmos-font-SpaceGrotesk`). Nothing enforces consistency between DB values and CSS variable names. Plan 5's editor UI should validate against an enum (or store a canonical key + map).
- `Weather.svelte` hardcodes `grid-template-columns: repeat(5, 1fr)` for the forecast row. The mock data is always 5 days, but `WeatherForecastDay[]` has no length constraint. Loosen to `repeat(auto-fill, minmax(...))` or pin the type when Plan 4 wires real HA data.
- `display/src/lib/ws.ts` reports `error`/`close` but does not retry. **(Plan 3 fixed: now reconnects with exponential backoff capped at 30s.)**
- `TransitionStage` skips `controller.receive` when the new scene has the same id as the previously rendered scene. On reconnect or REST PUT to the active scene, updated widget data is silently dropped. Will hurt once Plan 4's HA-driven widget data updates start flowing.
- `bridge.background_morph` in transition descriptors currently only extends bridge-phase duration; it does not drive true CSS color interpolation between gradient palettes (the layered cross-fade reads as a morph but isn't one). Either rename the flag or implement true interpolation in Plan 5.
- `stagger_ms` is part of `TransitionPhase` types but the CSS only animates the whole stage layer, not per-widget. Implement widget-level stagger or remove the field before Plan 5.
- Built-in transition descriptors live only inside the migration SQL string; if Plan 5 needs to expose or test them as a constant, extract to `server/src/transitions/builtins.ts`.
- `assemblePush` is currently synchronous. Plan 4 will need to make it `async` for HA reads — beware of the rapid-fire scene-change race on `lastSceneByDisplay` once `buildPayload` becomes async.

## Roadmap

- Plan 3: ✅ Shipped — transition engine with 6 built-ins + per-scene defaults + explicit overrides.
- Plan 4: ✅ Shipped — HA + MQTT integration with reactive entity-driven scene push, MQTT discovery + command topics, message overlay primitive.
- Plan 5: ✅ Shipped — admin editor at `/admin` for scenes, displays, settings. Iframe-friendly for HA sidebar panel mounting in Plan 6.
- Plan 6: ✅ Shipped — installable HA app (formerly called "add-on") with Supervisor auto-discovery, Ingress sidebar panel, multi-arch Docker images.
- Plan 7: 🛠 In progress — Scene Mood Engine. Looping video atmosphere layer per scene. Strategies: manual, time-of-day (sun.sun), weather. See `docs/superpowers/plans/2026-05-04-scene-mood-engine.md`.
