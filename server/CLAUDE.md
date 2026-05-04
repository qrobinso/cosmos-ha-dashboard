# Cosmos Server

Node + TypeScript server. Fastify HTTP, `ws` WebSocket hub, `better-sqlite3` persistence.

## Layout

- `src/config.ts` — env-driven runtime config. Path defaults are anchored to `import.meta.url` so the process works from any CWD.
- `src/store/` — pure persistence. One file per concern: `db.ts` (connection), `migrations.ts` (versioned, transactional), `displays.ts`, `settings.ts`, `scenes.ts`.
- `src/api/` — pure transport. `http.ts` builds the Fastify app and registers routes; `scenes.ts` registers scene-related routes; `ws.ts` attaches the WebSocket hub on the Fastify HTTP server.
- `src/scenes/` — domain logic for assembling scene state. `types.ts` defines `SceneState`/`WidgetState`; `mockData.ts` holds fixtures used until Plan 4 wires HA; `assembler.ts` builds a `SceneState` from a `Scene` + safe area.
- `src/static.ts` — serves the SvelteKit build via `@fastify/static`. Skips silently if the build dir is missing.
- `src/index.ts` — entrypoint. Opens DB, runs migrations, builds repos, builds Fastify, attaches WS, listens. Has SIGTERM/SIGINT graceful shutdown.
- `src/transitions/` — transition descriptor types + builtins.
- `src/store/transitions.ts` — read-only repo for built-in transitions + a small overrides repo for per-scene-pair custom transitions.
- `src/api/transitions.ts` — `GET /api/transitions(/:id)` exposed for the editor (Plan 5) and curl exploration.
- `src/ha/` — HA client interface, real implementation (`home-assistant-js-websocket`), in-memory entity cache, fake client for tests.
- `src/mqtt/` — MQTT client interface, real implementation (`mqtt`), command parser (pure), HA discovery payload builder, fake client for tests.
- `src/overlay/` — overlay message type.
- `src/api/ha-entities.ts` — `GET /api/ha/entities` listing cached HA entities (or mock fixtures when HA is disabled). Used by the admin editor's entity picker.

## Conventions

- ESM (`"type": "module"`). Imports use `.js` extensions because TypeScript is configured with `moduleResolution: "Bundler"`. This works for both `tsx` (dev) and `tsc` (build).
- Repos are factories: `createXRepo(db) → XRepo`. Prepared statements live in the closure; no per-call SQL strings.
- JSON columns are serialized at the repo boundary; consumers see typed objects.
- Migrations are versioned; the runner tracks `schema_version`. Each new migration adds an entry — never edit a published migration.
- All tests use `:memory:` SQLite + real factories. No mocks of the DB.

## Adding things

- A new widget kind: extend `WidgetKind` in `store/scenes.ts`, add a case in `scenes/assembler.ts` `dataFor()`, add a renderer in the display app.
- A new REST endpoint: register it in `api/http.ts` (or a new file under `api/` if scoped). Pass repo deps through `HttpDeps`.
- A new migration: append to `migrations.ts` with the next `version` number. Never modify version 1 or 2.
- A new built-in transition: append to migration `transitions` seed (new migration version). Add the corresponding `@keyframes` block to `display/src/lib/transitions/keyframes.css`.
- A new MQTT command: extend `parseCommandTopic` in `mqtt/commands.ts` and the matching dispatcher in `index.ts`.

## Tests

```bash
npm --workspace server test                  # full suite
npm --workspace server test -- scenes        # filter
npm --workspace server test -- ws            # filter
```

The WS tests start a real Fastify on an ephemeral port (`port: 0`) and connect with a real `ws.WebSocket` client. They are integration tests, not mocks.
