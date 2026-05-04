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

WebSocket protocol (server → display):
- `{type: 'welcome', displayId, message}` — sent on hello.
- `{type: 'scene', state: SceneState, transition?: TransitionDescriptor}` — sent on hello (without transition) and whenever the active scene changes (with transition resolved by the server).
- `{type: 'error', error}` — error reporting.

REST highlights:
- `POST /api/displays/register {name}` — register/find a display.
- `GET /api/displays` — list displays.
- `POST /api/scenes` / `GET /api/scenes` / `GET /api/scenes/:id` / `PUT /api/scenes/:id` / `DELETE /api/scenes/:id` — scene CRUD.
- `POST /api/displays/:name/assign-scene {sceneId, makeDefault?}` — assign a scene to a display.
- `GET /api/settings/safe-area` / `PUT /api/settings/safe-area {top,right,bottom,left}` — global safe-area padding.
- `POST /api/displays/:name/scene/activate {sceneId, transitionId?}` — set the active scene with optional explicit transition override.
- `GET /api/transitions` / `GET /api/transitions/:id` — list/get transitions.

## Where to look

- `docs/superpowers/plans/` — implementation plans (Plan 1 = Foundation, Plan 2 = Scenes & widgets, future plans coming).
- `docs/superpowers/specs/` — design specs (currently embedded inside the plans; standalone specs may land later).

## Conventions

- TDD: write the failing test first, run it and observe failure, implement, observe pass, then commit.
- Conventional commits: `feat|fix|chore|refactor(scope): subject`.
- Frequent small commits; each task in a plan is its own commit.
- Modules have one job; files stay focused enough to hold in context at once.
- Never modify Plan 1 / Plan 2 plan files retroactively; if a plan is wrong, surface it as a deviation in the implementer's report.

## Known tech debt (carry forward)

- `displays.registerByName` has a SELECT-then-INSERT race — fine at single-user scale, fix when concurrent reconnections become a thing.
- `scenes` repo `list()` and `listAssignedTo()` do N+1 widget queries — fine at < ~10 scenes.
- Widget input is not validated at the API layer (any JSON shape is accepted). Validation belongs at the API boundary; add when an editor UI lands (Plan 5).
- `Fastify({logger: false})` is hardcoded — wire to config when production logging matters.
- Scene `font_family` strings are matched to CSS variables by stripping spaces (`'Space Grotesk'` → `--cosmos-font-SpaceGrotesk`). Nothing enforces consistency between DB values and CSS variable names. Plan 5's editor UI should validate against an enum (or store a canonical key + map).
- `Weather.svelte` hardcodes `grid-template-columns: repeat(5, 1fr)` for the forecast row. The mock data is always 5 days, but `WeatherForecastDay[]` has no length constraint. Loosen to `repeat(auto-fill, minmax(...))` or pin the type when Plan 4 wires real HA data.
- `display/src/lib/ws.ts` reports `error`/`close` but does not retry. Reconnection-with-backoff should land before or alongside Plan 3's transition engine, otherwise a network blip leaves the page on a stale scene.

## Roadmap

- Plan 3: ✅ Shipped — transition engine with 6 built-ins + per-scene defaults + explicit overrides.
- Plan 4: HA + MQTT integration (real entity state, MQTT discovery, message overlay primitive).
- Plan 5: Editor UI inside an HA sidebar panel.
- Plan 6: Home Assistant add-on packaging.
