# MCP server for Cosmos — design

## Context

Cosmos already has an in-product LLM agent at `/admin/agent` that calls Cosmos's REST endpoints as tools via Vercel AI SDK. Plenty of users already have **other** agents running — Claude Desktop, Cursor, Codex, custom orchestrators — and want to ask those agents to inspect and modify their Cosmos wall display without opening Cosmos's UI.

The Model Context Protocol (MCP) is the de facto standard for that flow. This spec adds an MCP HTTP server to Cosmos so external agents can connect with a bearer token and call a curated set of tools backed by the existing REST endpoints.

The intent is *symmetry*: the in-product agent and an external Claude Desktop should both be able to "create a kitchen morning scene", with the same execution path under the hood.

## Goals & non-goals

**Goals:**
- External MCP clients can list scenes, create/edit scenes and widgets, and read the live HA entity catalog.
- One bearer token per Cosmos install; token rotation is one click.
- Off by default. Settings toggle to enable.
- Reuses the existing `app.inject(...)` execution path so MCP tools and in-product agent tools share validation + display-notification behavior.
- Resources surface so MCP-aware clients (Claude Desktop) can browse the agent contracts and HA entities without burning tool calls.

**Non-goals (v1):**
- Destructive tools (`activate_scene`, `delete_scene`, `delete_widget`) are **not** exposed. External clients can't render Cosmos's confirm card, and the user has no good way to undo. They stay in the in-product agent only.
- OAuth 2.1 (the MCP spec's blessed auth path). Bearer-token-in-settings matches Cosmos's existing posture (OpenRouter key, etc.) and is ~10× less code.
- Per-client session tracking. Every tool call goes through stateless `app.inject` — multiple clients can connect concurrently with no coordination.
- A separate process / port. The MCP transport mounts on the existing Fastify instance at `/mcp`.

## Architecture

```
External MCP client (Claude Desktop, Cursor, …)
          │
          │ HTTP + Authorization: Bearer cosmos_mcp_…
          ▼
┌──────────────────────────────────────────────────────────┐
│  Cosmos Fastify (port 8099)                              │
│                                                          │
│  /mcp  ── StreamableHTTPServerTransport (MCP SDK 1.29)   │
│   ├─ preHandler: auth gate (mcp_enabled + mcp_token)     │
│   ├─ tools registry (11 tools)                           │
│   │    └─ each tool's `execute` calls app.inject(...)    │
│   │       to reuse the existing /api/* validation paths  │
│   └─ resources registry (3 resources)                    │
│        ├─ cosmos://docs/scene-agent                      │
│        ├─ cosmos://docs/canvas-widget-agent              │
│        └─ cosmos://entities  (regenerated per fetch)     │
└──────────────────────────────────────────────────────────┘
```

**Stack:** `@modelcontextprotocol/sdk@^1.29` + existing zod 3. Compatible with Cosmos's current Fastify 4 / Node 20 setup.

## Tool surface

The 11 auto-execute tools from `server/src/agent/tools.ts`, mirrored for MCP:

- `list_scenes`
- `get_scene(id)`
- `create_scene(payload)`
- `update_scene(id, payload)`
- `list_widgets({scene?, kind?})`
- `patch_widget(id, partial)`
- `update_widget_content(id, content)`
- `list_displays`
- `assign_scene_to_display(displayName, sceneId, makeDefault?)`
- `list_ha_entities(domain?)`
- `list_transitions`

All execute the same way: zod-validated args → `app.inject({method, url, payload})` → return JSON or `{ isError: true, content: [{type:'text', text}] }` on validation failure.

**Tool descriptions are written for the external-agent audience**, not Cosmos's in-product agent — same shape, different prose. The two surfaces stay in their own files (`mcp/tools.ts` vs `agent/tools.ts`) so descriptions can drift without coupling.

## Resource surface

| URI | Source | Refresh |
|---|---|---|
| `cosmos://docs/scene-agent` | `docs/scene-agent.md` on disk | Cached on first read; static for the process lifetime |
| `cosmos://docs/canvas-widget-agent` | `docs/canvas-widget-agent.md` on disk | Same |
| `cosmos://entities` | `renderHaEntitiesDoc(haClient)` from `server/src/api/docs.ts` | Regenerated per fetch — always live |

MCP clients like Claude Desktop show resources in a sidebar. The user can attach the agent contracts as context for one-off prompts without spending tool calls on `list_ha_entities` etc.

## Auth + token lifecycle

**Token shape:** `cosmos_mcp_<64 hex chars>` from `crypto.randomBytes(32)`. The `cosmos_mcp_` prefix is greppable in logs / leaked configs and recognizable to the user.

**Settings keys** (stored in the existing SQLite `settings` table):
- `mcp_enabled` — `'true'` | `''`
- `mcp_token` — the token string, or `''`

**State machine:**

| State | `/mcp` requests return |
|---|---|
| `mcp_enabled` empty | `503 {"error": "MCP server not enabled"}` |
| `mcp_enabled` set, `mcp_token` empty | `503 {"error": "MCP token not generated"}` (transient — UI generates immediately on enable) |
| `mcp_enabled` set, `mcp_token` set | `401` if `Authorization` header missing/wrong, otherwise upgrade to MCP transport |

**Auth gate:** Fastify `preHandler` on every `/mcp/*` route. Uses `crypto.timingSafeEqual` (equal-length compare with constant-time semantics) to prevent timing-based token guessing.

**Regeneration** invalidates the old token immediately. UI confirms first: *"Regenerating will disconnect any agent currently connected. They'll need the new token. Continue?"*

**Disable** keeps the token (re-enabling restores it without forcing reconfiguration of every client). Clearing the token requires the explicit Regenerate action.

## File layout

| Path | Responsibility |
|---|---|
| `server/src/mcp/server.ts` | Build the MCP `Server` from the SDK; register tools + resources; return it. Pure factory, no HTTP knowledge. |
| `server/src/mcp/tools.ts` | The 11 tool definitions: name, description (MCP-audience), zod schema, execute → `app.inject(...)`. Same factory pattern as `agent/tools.ts`. |
| `server/src/mcp/resources.ts` | Three resource handlers — read the two contracts from disk (cached), regenerate `cosmos://entities` from `haClient` per fetch (reusing `renderHaEntitiesDoc`). |
| `server/src/api/mcp.ts` | Fastify route layer. Owns `/mcp`, auth gate, the `StreamableHTTPServerTransport` wiring, and the three settings endpoints (`GET /api/agent/mcp`, `POST /api/agent/mcp/enable`, `POST /api/agent/mcp/regenerate`). |
| `server/src/store/mcp-token.ts` | `getToken(settings)`, `regenerateToken(settings)`, `clearToken(settings)`. Thin wrappers over the settings repo for clarity at call sites. |
| `server/test/mcp-tools.test.ts` | 11 tests covering auth, tools, resources, and token rotation (see Testing). |

**Modified:**

| Path | Change |
|---|---|
| `server/src/api/http.ts` | Wire `registerMcpRoutes(app, deps)` after the existing agent routes. |
| `display/src/lib/admin/api.ts` | New helpers: `agent.getMcpConfig()`, `agent.enableMcp(enabled)`, `agent.regenerateMcpToken()`. |
| `display/src/routes/admin/settings/+page.svelte` | New "Agent-to-agent (MCP)" card. |
| `addon/CHANGELOG.md` + `addon/config.yaml` | Bump to `0.5.0` (notable user-visible feature). |

## Settings UI

A new card in `/admin/settings`, placed below the existing "AI agent" card.

```
┌─ Agent-to-agent (MCP) ──────────────────────────────┐
│ Let external agents (Claude Desktop, Cursor, etc.)  │
│ connect to Cosmos to inspect and edit your wall     │
│ display. Read + edit only — destructive actions     │
│ are never exposed.                                  │
│                                                     │
│ [○] Enable MCP server                               │
│                                                     │
│ ── shown when enabled ────────────────────────────  │
│ Endpoint:  http://homeassistant.local:8099/mcp      │
│ Token:     cosmos_mcp_a3f9b2…  [Copy] [Regenerate]  │
│                                                     │
│ ┌─ Claude Desktop config ──────────────────────────┐│
│ │ {"mcpServers": {"cosmos": {                      ││
│ │   "url": "…/mcp",                                ││
│ │   "headers": {"Authorization": "Bearer …"}       ││
│ │ }}}                       [Copy snippet]         ││
│ └──────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

- Endpoint URL: `${window.location.origin}/mcp` — picks up whatever host the user is on.
- Toggle off → server returns 503, card collapses. Token preserved.
- Toggle on → if no token, one is generated immediately; card expands with the value visible.
- **Copy** buttons drop value to clipboard with a 2s "Copied" status (same affordance as the existing Docs Copy-markdown button).
- The Settings GET (admin-side, same origin) does return the token so the user can copy it. The MCP transport endpoint never returns it.

## Data flow + error handling

**Tool call (happy path):**

1. Client sends MCP `tools/call {name, arguments}` to `/mcp`.
2. Auth gate passes.
3. SDK looks up the tool, validates `arguments` against the zod schema.
4. Execute runs `app.inject({method, url, payload})` against the same Fastify.
5. Result wrapped as MCP `{content: [{type: 'text', text: JSON.stringify(...)}]}`.

**Resource read:**

1. Client sends `resources/read {uri}`.
2. Server dispatches by URI prefix.
3. For docs URIs: read from disk (cached). For `cosmos://entities`: call `renderHaEntitiesDoc(haClient)`.
4. Return as `{contents: [{uri, mimeType: 'text/markdown', text}]}`.

**Error categories:**

| Category | Behavior |
|---|---|
| Server config (disabled, no token) | HTTP `503` with JSON `{error}` *before* the SDK is invoked |
| Wrong / missing bearer | HTTP `401` with body `{"error": "invalid or missing bearer token"}` — same message either way; we don't distinguish "you forgot the header" from "you used the wrong token", to avoid leaking which is the case to a probing client |
| Tool validation (e.g. invalid scene payload) | MCP tool result `{isError: true, content: [{type: 'text', text: '<api error>'}]}` so the model can self-correct |
| HA disconnected for `list_ha_entities` | Same shape; text says "Home Assistant is not connected on this Cosmos instance." Mirrors the in-product agent behavior. |
| Unknown tool / bad params | SDK-native JSON-RPC errors (`-32601`, `-32602`) |

**Logging:** one line per tool call: `[mcp] tools/call create_scene 200 (147ms)`. Token never logged. Args truncated to 200 chars.

**Concurrency:** stateless. No coordination between concurrent clients.

## Testing

`server/test/mcp-tools.test.ts` covers:

1. `503 when disabled` — `/mcp` rejects before checking auth.
2. `503 when enabled but no token` — transient state.
3. `401 when wrong / missing bearer` — auth gate rejects.
4. `200 with correct bearer` — handshake completes.
5. `tools/list returns the 11 tools` — no destructive tools present.
6. `create_scene round-trip` — MCP `tools/call` → `app.inject` → repo updated.
7. `tool validation error returns isError:true` — invalid payload doesn't crash the transport.
8. `list_ha_entities surfaces HA-disconnected` — error path matches the in-product agent.
9. `resources/list returns docs + entities` — three URIs advertised.
10. `resource read returns markdown for the two contracts` — file-backed resources work.
11. `resource read returns live entity catalog` — `cosmos://entities` regenerates per call.
12. `regenerate invalidates old token` — two requests with old token: first 200, second 401.
13. `timingSafeEqual rejects partial-prefix tokens` — sanity test.

**Manual verification (smoke):**

1. Enable MCP in Settings, copy token.
2. `curl -H "Authorization: Bearer <token>" -X POST http://localhost:8099/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` returns the 11 tools.
3. Add to Claude Desktop config; restart Claude Desktop.
4. *"What scenes do I have on my Cosmos?"* — Claude Desktop calls `list_scenes`, summarizes.
5. Regenerate the token in Settings; Claude's next message returns 401; clean disconnect surfaces in Claude Desktop's MCP panel.

## Risks & open items

- **Spec compatibility:** MCP SDK 1.29 implements spec version 2025-03-26 (Streamable HTTP). Older clients on the SSE transport spec will not connect. Acceptable; Claude Desktop and Cursor have caught up.
- **Token leakage in admin localStorage / DOM:** The Settings UI displays the token to the user. Anyone with admin access (already the case for Cosmos) can read it. No change in posture.
- **No rate limiting on `/mcp`:** matches the rest of Cosmos's API. A client can spam tool calls. Acceptable for self-hosted; revisit if abuse appears.
- **Body size limits:** the MCP transport may receive large payloads (full scene JSON). Need to confirm Fastify's default body limit accommodates; bump if necessary.
- **Resource caching:** the two doc resources are cached for the process lifetime. Restarting Cosmos picks up doc changes. Acceptable for a self-hosted addon.

## Out of scope (future)

- OAuth 2.1
- Per-client session tokens / revocation lists
- Resource subscriptions (push-notify clients when entities change)
- Prompts (templated multi-turn workflows the client can invoke)
- A second MCP transport (stdio) for local-only flows
- Exposing `activate_scene` / `delete_scene` / `delete_widget` with a "destructive" annotation
