# Cosmos design pack library

## Context

The Cosmos in-product agent and external MCP agents currently produce visually inconsistent canvases. Two agents asked for "a kitchen morning tile" five minutes apart will pick different palettes, fonts, and layout densities — there's no shared taste layer. The existing `docs/scene-agent.md` and `docs/canvas-widget-agent.md` define what's *possible* (the API), not what's *good* (the visual language).

This feature adds a library of **design packs** — markdown files conforming to the [google-labs-code/design.md](https://github.com/google-labs-code/design.md) spec — that act as the missing taste layer. The user picks a pack from a dropdown above the chat composer; it gets appended to the system prompt verbatim. External MCP agents do the same via resources or tools, and can author new packs that persist back to Cosmos.

Outcome: predictable visual results from the agent, a small library of curated built-in aesthetics, and an extension point where the user (or an MCP-driven agent) can add their own.

## Decisions (locked with user)

1. **Composition:** Supplement. Scene-agent and canvas-widget contracts always go in the system prompt; the selected design pack is appended on top.
2. **Format:** DESIGN.md as published by google-labs-code. YAML frontmatter (`colors`, `typography`, `rounded`, `spacing`, `components`) + canonical markdown body sections (Overview, Colors, Typography, Layout, Elevation, Shapes, Components, Do's and Don'ts). No Cosmos-specific fork.
3. **Persistence:** SQLite table `design_packs (id, slug, name, content, source, created_at, updated_at)` with `source ∈ ('builtin','user')`. Built-ins live as `.md` files in `server/src/designs/builtins/` and are upserted into the table on server startup (so addon updates can ship updated built-ins). Built-ins are read-only over the API.
4. **Selection:** Per-conversation, sticky. Dropdown above the chat composer in `/admin/agent`, persisted in localStorage as `cosmos.agent.designPack` (slug). Sent in the chat request body as `designPackSlug`. External MCP agents pick per-call.
5. **Admin UI scope:** Dropdown + preview only in v1. No library/edit page. Power users author via MCP `create_design` or by hand-editing through MCP `update_design`.
6. **Built-ins to ship:** four — **Quiet Luxury**, **Editorial**, **Neo-Brutalist**, **Soft Ambient**.

## Architecture

```
┌──────────────────────────────────┐         ┌────────────────────────────────────┐
│  /admin/agent (Chat.svelte)      │         │  Cosmos server                     │
│                                  │         │                                    │
│  [Design pack ▾] (dropdown)      │ ─POST▶  │  POST /api/agent/chat              │
│  ↳ swatch + font preview         │ {…,     │   { messages, designPackSlug }     │
│  ↳ persists in localStorage      │  designPackSlug } │  ↓                       │
│                                  │         │  buildSystemPrompt(deps,           │
│                                  │         │     { designPackSlug })            │
│                                  │         │   ↓                                │
│                                  │         │  scene-agent.md +                  │
│                                  │         │  canvas-widget-agent.md +          │
│                                  │         │  HA entities snapshot +            │
│                                  │         │  ─── DESIGN PACK ──                │
│                                  │         │  designPacks.getBySlug(slug).body  │
│                                  │         │   ↓                                │
│                                  │         │  streamText(...) → SSE             │
│                                  │         └────────────────────────────────────┘
└──────────────────────────────────┘                          │
                                                              ▼
                                              ┌──────────────────────────────────┐
                                              │  SQLite design_packs             │
                                              │  ─ seeded from builtins/ at boot │
                                              │  ─ user rows from POST/PATCH     │
                                              └──────────────────────────────────┘

External MCP agents:
  resources/list  → cosmos://designs
  resources/read  → cosmos://designs/<slug>
  tools/call      → list_designs / get_design / create_design / update_design
```

## Files to create

| Path | Purpose |
|---|---|
| `server/src/store/design-packs.ts` | Repo factory `createDesignPacksRepo(db)` with `list`, `get`, `getBySlug`, `create`, `update`, `delete`, `seedBuiltins(dir)`. Mirrors existing repo pattern. |
| `server/src/store/migrations.ts` (extend) | New migration version: `CREATE TABLE design_packs (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('builtin','user')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)` + index on `slug`. |
| `server/src/designs/parse.ts` | Pure helper: parse a DESIGN.md file → `{ frontmatter, body, errors }`. Uses `js-yaml`. |
| `server/src/designs/builtins/quiet-luxury.md` | Built-in pack. |
| `server/src/designs/builtins/editorial.md` | Built-in pack. |
| `server/src/designs/builtins/neo-brutalist.md` | Built-in pack. |
| `server/src/designs/builtins/soft-ambient.md` | Built-in pack. |
| `server/src/api/designs.ts` | `registerDesignRoutes(app, deps)` — REST endpoints listed below. |
| `server/test/design-packs.repo.test.ts` | Repo unit tests against `:memory:` SQLite. |
| `server/test/designs.api.test.ts` | REST integration tests covering listing, read, create, update (rejects on built-ins), delete (rejects on built-ins), frontmatter validation. |
| `server/test/designs.parse.test.ts` | Parser unit tests: well-formed, malformed YAML, missing frontmatter, only frontmatter no body, etc. |
| `display/src/lib/admin/DesignPackPicker.svelte` | The above-composer dropdown + swatch + font preview. |
| `docs/design-pack-authoring.md` | User-facing primer for creating a design pack via MCP — references the design.md spec, shows a Cosmos-specific example, explains how token refs translate to scene/widget config. |

## Files to modify

| Path | Change |
|---|---|
| `server/src/agent/system-prompt.ts` | `buildSystemPrompt(deps, opts?)` accepts `{ designPackSlug?: string }`. When set and the pack exists, append a `─── DESIGN PACK ───` section with the pack's full content. Preamble gains a paragraph: "When a design pack is provided, use its frontmatter tokens for exact values (colors, typography, spacing) and the body prose for taste/voice. Never override scene-API rules from the contracts above." |
| `server/src/api/agent.ts` | `POST /api/agent/chat` reads `request.body.designPackSlug` (string \| undefined), validates the pack exists if provided, passes to `buildSystemPrompt`. |
| `server/src/api/http.ts` | Wire `registerDesignRoutes` and pass the new `designs` repo through `HttpDeps`. |
| `server/src/index.ts` | Build `designs` repo, call `designs.seedBuiltins(builtinsDir)` after `runMigrations`. |
| `server/src/mcp/tools.ts` | Add `list_designs`, `get_design`, `create_design`, `update_design` (no `delete_design` in v1 — admin only). All four use the same inject pattern as existing tools, hitting the new REST endpoints. |
| `server/src/mcp/resources.ts` | Add `cosmos://designs` (lists slugs + names) and dynamic `cosmos://designs/<slug>` resolution. The `listMcpResources` static list grows with one entry per design pack at request time. |
| `display/src/lib/admin/Chat.svelte` | Mount `<DesignPackPicker>` above the composer textarea. Read selected slug on mount from localStorage. Pass to `useChat` so it goes in the request body via `body: { designPackSlug }`. |
| `display/src/lib/admin/api.ts` | New `designs.list()`, `designs.get(slug)` wrappers. |
| `addon/CHANGELOG.md` + `addon/config.yaml` | Bump `0.5.5` → `0.6.0` (new feature). Changelog entry covers the library, dropdown, MCP surface. |

## REST surface

| Method | URL | Body / Query | Returns | Notes |
|---|---|---|---|---|
| GET | `/api/designs` | — | `[{id, slug, name, source, preview: {colors[], font_family}}]` | Light shape for the dropdown — no `content`. `preview.colors` = first 4 hex values flattened from `frontmatter.colors`. `preview.font_family` = `frontmatter.typography.body.fontFamily` if present. |
| GET | `/api/designs/:idOrSlug` | — | `{id, slug, name, source, content, frontmatter, body, parseErrors[]}` | Full content. `frontmatter` and `body` are the parsed split; `parseErrors` lists YAML or schema warnings (non-fatal). |
| POST | `/api/designs` | `{slug, name, content}` | created row | Rejects 400 on duplicate slug, missing fields, frontmatter that fails YAML parse. `source` is forced to `user`. |
| PATCH | `/api/designs/:idOrSlug` | `{name?, content?}` | updated row | Rejects 403 if `source='builtin'`. `slug` is immutable. |
| DELETE | `/api/designs/:idOrSlug` | — | 204 | Rejects 403 if `source='builtin'`. |

## MCP surface

**Resources** (added to `listMcpResources`):
- `cosmos://designs` — index, returned as `text/markdown`. One line per pack: `<slug> — <name> (built-in|user)`.
- `cosmos://designs/<slug>` — full pack, returned as `text/markdown`. Resolved dynamically by extracting the slug from the URI.

**Tools** (added to `createMcpTools`):
- `list_designs()` → `[{slug, name, source, preview}]`. Same shape as `GET /api/designs`.
- `get_design({slug})` → full pack content + parsed frontmatter.
- `create_design({slug, name, content})` → creates a user pack. Description warns the agent to follow the design.md spec and points at `cosmos://docs/design-pack-authoring`.
- `update_design({slug, name?, content?})` → updates a user pack. Rejects on built-ins.

`delete_design` is **not** exposed via MCP in v1. Deletion is an admin-only action through the REST API (and a future v2 admin library page).

## DESIGN.md compliance notes

- The parser tolerates missing frontmatter (treats the whole file as body) but the dropdown preview will be blank for those — agents and users are encouraged to include at least `colors` and `typography.body.fontFamily`.
- We do not implement the `design-md lint` ruleset in v1 — `parseErrors` only flags YAML syntax errors. Schema validation (e.g. "components must reference defined token paths") is deferred.
- Token references like `{colors.primary}` are passed through verbatim. The agent resolves them at scene-emission time using the frontmatter values it can see in the prompt. We do not pre-resolve server-side.

## Built-in pack briefs

Each ships as a real DESIGN.md file. The implementer should write them in the spec format, ~150-300 words of body each, with frontmatter tokens chosen to read well at room-distance on a wall display.

- **`quiet-luxury.md`** — Calm, warm, generous whitespace. Palette: warm near-black, dusty taupe, champagne accent, cream text. Typography: Fraunces (display), Inter (body). Density: low. Voice: editorial calm.
- **`editorial.md`** — Magazine-cover energy. High contrast type, generous baselines. Palette: ink black, paper white, single warm red accent. Typography: Fraunces or Playfair (display, very large), Inter (body small). Density: medium with strong hierarchy.
- **`neo-brutalist.md`** — High contrast, blocky, no rounding. Palette: pure white, pure black, one saturated accent (electric blue). Typography: JetBrains Mono everywhere. Density: high. Voice: utilitarian.
- **`soft-ambient.md`** — Low contrast, mood-video-friendly. Palette: muted lilac → peach gradient family with translucent surfaces. Typography: Inter at low weight. Density: very low. Designed to overlay nicely on the Mood Engine's video layer.

## Verification

End-to-end checks the implementer should run before declaring done:

1. **Tests:** `npx vitest run --pool=forks --poolOptions.forks.singleFork --root server` — all green, including new `design-packs.repo`, `designs.api`, `designs.parse` files.
2. **Builds:** `npm --workspace server run build` and `npm --workspace display run build` clean.
3. **Boot smoke:** Start dev server. `curl localhost:8099/api/designs` returns the four built-ins with correct `preview` shape.
4. **Round-trip via REST:** `POST /api/designs` with a minimal pack → `GET /api/designs/:slug` returns it → `PATCH` updates the name → `PATCH` against a built-in slug returns 403 → `DELETE` against the user pack returns 204.
5. **Round-trip via MCP:** With MCP enabled and a token, `tools/call list_designs` returns 4+; `tools/call get_design {slug:"quiet-luxury"}` returns full content; `tools/call create_design` creates and `tools/call get_design` reads it back.
6. **Admin UI:** Open `/admin/agent`. Dropdown shows the four built-ins (+ any user packs). Selecting one shows swatch row + font chip. Reload page — selection persists. Send a message — Network tab shows `designPackSlug` in the chat request body.
7. **System prompt assertion:** Add a test case in `agent.system-prompt.test.ts` that calls `buildSystemPrompt(deps, {designPackSlug: 'quiet-luxury'})` and asserts the result contains `─── DESIGN PACK ───` plus a string from the pack body. Without the slug, that section is absent.
8. **Visual smoke (optional but valuable):** Tell the in-product agent: "Create a kitchen morning scene" with **Quiet Luxury** selected vs **Neo-Brutalist** selected. The two scenes should clearly look different. This is the whole point of the feature.

## Risks & open items

- **Frontmatter parsing dependency:** If `js-yaml` isn't already in the server workspace, adding it adds a small dep. Acceptable.
- **Built-in upsert on every boot** could overwrite user edits if a user manually changes a built-in row in SQLite. We don't expose that path through any UI, so the risk is theoretical, but the upsert should match on `slug` AND `source='builtin'` to be safe.
- **MCP resource pagination:** `cosmos://designs/<slug>` adds N entries to `listMcpResources`. With 4 built-ins + ~5 user packs typical, that's fine. If a user creates 50 packs, the resources list gets noisy. Acceptable in v1.
- **Token budget:** A typical DESIGN.md is 1-3K tokens. Adding it to the system prompt on top of the existing ~10-15K is fine on Claude (prompt caching). Cheap on others. Same posture as the original agent plan.
- **Display app vs admin app boundary:** The `DesignPackPicker` lives under `display/src/lib/admin/`. Today the admin code only ships the agent surface; if a future admin library page lands, it can reuse `DesignPackPicker` or factor a thinner `DesignPackPreview`.

## Out of scope for v1 (carry forward)

- Library page in admin with view/edit/delete UI (defer to v2).
- In-browser markdown editor for packs.
- Schema-level frontmatter validation (color hex format, typography schema).
- Token resolution server-side (`{colors.primary}` → `#0d0c0a`).
- Per-display default design pack.
- Pack inheritance (`extends: another-pack`).
- Auto-detection of "best pack" given a user prompt.
