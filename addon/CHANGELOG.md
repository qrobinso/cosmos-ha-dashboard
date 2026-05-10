# Changelog

## 0.6.8

- Docs: **Canvas-widget agent contract tightened from real-world feedback.** Authoring agents previously needed 2–3 follow-up rounds to escape a generic "form on a page" aesthetic. The doc now codifies the patterns that emerged organically across production scenes: hero numerals (Inter, weight 500, ~7rem, accent color), kicker labels (Inter, 0.75rem, 600, uppercase, 0.12em tracking, 0.55 opacity), glassmorphism cards (`rgba(255,255,255,0.05)` over `rgba(255,255,255,0.08)` border), the "adaptive priority" pattern (show all at 0.28 opacity, promote one to 1.0 with a colored glow), and length-bucketed `font-size` for variable LLM content. Tightens existing rules: the never-hardcode-color rule now carves out hero numerals + status colors; the font-family rule now mandates Inter for labels/units even on serif scenes; every `font-size` should multiply by `--cosmos-font-scale`. Adds two missing forbidden items: camera images in canvases (with the `floatWidgets` overlay trick spelled out) and `weather.*` forecast attributes (gone from the entity in HA 2024.4+). Clarifies that `cosmos.subscribe` already seeds the callback with current state on attach — no `cosmos.entity()` prelude needed.

## 0.6.7

- Feat: **Canvas calendar bridge** — `cosmos.getCalendarEvents(entityId, startIso, endIso)` reads a windowed list from any HA `calendar.*` entity through Cosmos's already-authenticated server connection. No allowlist setup required (unlike `cosmos.fetch` to the user's own HA URL). Closes a frustrating UX gap where the native calendar widget could pull a 60-day window via `calendar.get_events` but a canvas widget had no equivalent. Server caches per `(entity, day-aligned window)` for 5 minutes with concurrent-call coalescing — same shape as the weather-forecast cache shipped in 0.6.1, so a canvas calling on a tick is safe. Agent + user docs explicitly steer canvas authors here for `calendar.*` entities and call out that no other HA service-call bridges exist today.

## 0.6.6

- Feat: Canvas widgets now receive the scene's resolved text color as `--cosmos-fg` (and `cosmos.tokens.fg`). Priority matches `SceneCanvas`: `typography.color` override > background auto-contrast pick > kiosk default. The bridge also sets a `body { color: var(--cosmos-fg, #f5f5f5) }` default so canvases inherit the right color without changes. Agent + user docs updated to instruct authors to use `color: var(--cosmos-fg, #f5f5f5)` rather than hardcoding white.

## 0.6.5

- Feat: **Auto-contrast text** for scene backgrounds. New checkbox in the editor's Background panel; when on, the kiosk picks near-black or near-white widget text based on the average WCAG luminance of the active gradient/solid color, so light backgrounds (peach, cream, pastel) no longer wash out white text. Threshold is the WCAG-derived 0.179 on weighted RGB luminance, no dependencies, ~40 lines. Reactive to `sun_adaptive` and `adaptive_colors` runtime palette swaps; a 600 ms color transition smooths the moment a scene crosses the threshold.
- Feat: **Per-scene text color override** under Typography. New color picker (with Clear button) sets `typography.color`. When set, it wins over auto-contrast and the kiosk default — useful when you want a specific brand color regardless of background. The MCP `patch_scene` tool's typography schema accepts the new field.

## 0.6.4

- Fix: Agent chat broke for **every OpenAI/Azure-routed model** with `Invalid schema for function 'patch_scene': array schema missing items`. Root cause: `patch_scene.layout.items` was typed as `z.array(z.any())`, and the AI SDK's zod-to-JSON-Schema conversion drops the `items` keyword for `z.any()` element types — Anthropic accepts that, OpenAI/Azure strict-mode tool validation rejects it. Switched to `z.array(z.unknown())` so the converter emits `items: {}` and any model can call the tool.

## 0.6.3

- Fix: Agent error reporting now extracts and surfaces the upstream provider's actual message. Previously a typo'd model name (e.g. `google/gemini-3.1-flash-lite` — doesn't exist) returned `AI_APICallError: Provider returned error` with no further detail in either the chat UI or the addon log. The handler now duck-types the AI-SDK error to pull out `statusCode`, `url`, and `responseBody`, parses OpenRouter's standard `{"error":{"message":...}}` shape, and surfaces that message in both the addon log and the 503 returned to the chat UI. Net effect: the next bad model setting / billing problem / auth failure is self-diagnosing.

## 0.6.2

- Fix: Agent chat failures used to surface in the UI as `Failed after 3 attempts. Last error: Cannot connect to API:` with **nothing in the addon log** to debug from (Fastify is configured with `logger: false`, so unhandled route errors fell on the floor). Now `/api/agent/chat` wraps the `streamText` call, logs the full error chain — message + cause + stack — to the addon log, and returns a clearer `503` to the chat UI: `Couldn't reach the LLM. <detail> (cause: <inner>). Check the addon log for full details.` Same primary failure surface; just visible from both ends now.

## 0.6.1

- Fix: Addon was crash-looping on chatty HA installs (visible to users as constant kiosk WebSocket reconnects and jerky scene transitions). Two compounding bugs: (1) every scene push fired a fresh `weather.get_forecasts` RPC — dozens per second on busy installs — and when the HA WS hiccupped (`Connection lost` / code 3) the call storm caused a stray rejection to escape the local try/catch through `home-assistant-js-websocket`'s internal cleanup, killing the Node process; (2) Supervisor restarted the container, kiosk reconnected, scene re-rendered, repeat. Fixes: (a) forecast results now cached for 5 minutes per `(entity, type)` with concurrent-call coalescing — eliminates the call storm; (b) process-level `unhandledRejection` and `uncaughtException` guards log loudly but no longer exit, so future stray library rejections can't kill the addon.
- Feat: Adaptive gradient — when a scene's gradient has `adaptive_colors: true`, the kiosk pulls live colors from widgets (album art on `media_player`, `cosmos.reportColors([...])` from canvas widgets) and overrides `gradient.colors` server-side. Editor toggle: **Adapt to widget colors** in the gradient block; pairs with `sun_adaptive`. The `colors` field becomes the fallback / padding palette. Canvas bridge gains `cosmos.reportColors(colors: string[])`. New REST + MCP surface `GET /api/displays/<name>/palette` so agents can read what's currently driving the wall.
- Feat: Gradient color changes now crossfade rather than snap. Duration scales with the global transition-speed multiplier (default 800 ms × multiplier — Fast 480 ms, Slow 1200 ms). The drift animation is unaffected; only the color stops swap.
- Feat: Canvas bridge gains `cosmos.fetch(url, init?)` — the parent does the request on the iframe's behalf, gated by an admin-managed allowlist (off by default; `Admin → Settings → Canvas fetch`). Lets canvases pull RSS / news / weather APIs without weakening the iframe sandbox. Body cap 2 MB, 15 s timeout, no credentials forwarded, post-redirect host re-validation.
- Feat: Canvas widgets accept `config.name`. Surfaced in the editor as **Name (optional)** and used by the agent's `list_widgets({ name })` filter so users can refer to a canvas by label ("the news-headlines canvas") instead of an opaque UUID.
- Refactor: Single tool catalog shared between the in-product `/admin/agent` and external MCP. `mcp/tools.ts` is now the source of truth; the in-product agent derives its tool set via a thin adapter. Confirm-required tools (`activate_scene`, `delete_scene`, `delete_widget`) gain a metadata flag; the agent adapter strips `execute` so the chat UI shows a confirm card while MCP keeps full execute. Token-efficiency projections (e.g. trimming canvas content in `list_widgets`) move to a per-tool `summarizeForAgent` hook applied only by the in-product agent.
- Feat: New mood clips. 21 seamless-looped MP4s added (abstract1, audio-loop, audio-loop2, box, cubic, earth, galaxy1, galaxy2, no-signal, red-blue-light-waves, spaceship, sun, plus a `wiggly-*` family of UI-tone loops). Raw `.mov` drops are now gitignored to prevent accidental >100 MB pushes.

## 0.6.0

- Feat: **Design pack library**. The in-product agent and external MCP agents now pull from a library of [DESIGN.md-spec](https://github.com/google-labs-code/design.md) packs that act as a shared visual taste layer on top of the existing scene/canvas API contracts. Four built-ins ship with this release: **Quiet Luxury**, **Editorial**, **Neo-Brutalist**, **Soft Ambient**.
- Feat: New dropdown above the chat composer in `/admin/agent` lets users pick a design pack per conversation. Selection is sticky in localStorage (`cosmos.agent.designPack`); the slug rides along on every chat request and is appended to the system prompt server-side. Picking "None" reverts to the previous (pack-less) behaviour.
- Feat: New MCP tools `list_designs`, `get_design`, `create_design`, `update_design` (no destructive `delete_design` — admin-only). New MCP resources `cosmos://designs` (index) and `cosmos://designs/<slug>` (full pack content). External agents can now author and persist new packs back to Cosmos for reuse.
- Feat: New REST surface — `GET/POST/PATCH/DELETE /api/designs(/:idOrSlug)`. Built-in packs are read-only (PATCH/DELETE return 403); user packs are full CRUD.
- Docs: New `docs/design-pack-authoring.md` primer for users + agents creating packs.

## 0.5.5

- Fix (docs): The recommended canvas font-family pattern was producing Times New Roman on the wall. Old recipe was `font-family: var(--cosmos-font-family, system-ui)` — the `system-ui` inside `var()` only fires when the variable is undefined, which it never is. The canvas iframe is sandboxed (`sandbox="allow-scripts"`, null origin) and can't load Cosmos's bundled `@fontsource` fonts, so the named scene font (e.g. `"Space Grotesk"`) usually fails to resolve and the browser falls through to its ultimate default. Updated `docs/canvas-widget.md`, `docs/canvas-widget-agent.md` (and every code example in both) to recommend a chained fallback **outside** the `var()`: `font-family: var(--cosmos-font-family, system-ui), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Added an explanatory callout in both docs so the next agent reading the contract understands why the chain matters.
- Feat: New entity-discovery surface for agents working against installs with thousands of HA entities. Slurping the full list into a system prompt blew up context and diluted attention; this gives agents a layered narrow-then-read pattern.
  - `GET /api/ha/entities/summary` (and MCP `summarize_ha_entities`) returns `{total, domains, deviceClasses}` — a tiny orientation snapshot to call first when the agent has no idea what's installed.
  - `GET /api/ha/entities` (and MCP `list_ha_entities`) now accepts `domain`, `device_class`, `search` (case-insensitive substring against `entity_id` + `friendly_name`), and `limit` — AND-combined. The MCP response includes `{count, totalMatches, truncated}` so the agent can tell when more rows existed than were returned (default cap 200).
  - Both `docs/scene-agent.md` and `docs/canvas-widget-agent.md` now lead with the discovery pattern, including the canvas-template-driven case ("don't guess `sensor.power` — search for it first").
- Feat: MCP surface now exposes `delete_scene` and `delete_widget`. Both are marked ⚠️ DESTRUCTIVE in their tool descriptions so well-behaved MCP clients surface a confirm prompt. Previously agents had to ask the user to delete by hand, breaking the closed-loop "edit on the wall" experience.
- Fix: Comprehensive validation hardening across the scene + widget API surface, driven by a Claude Code retro that uncovered nine paths from "agent sends bad payload" → "scene quietly broken" or "500 Internal Server Error". Every gap is now a 4xx with a clear field-path message:
  - Widget `position` is bounds-checked against the scene's layout — `col`, `row`, `w`, `h` must be positive integers, and `col + w - 1` cannot exceed `layout.cols` (same for rows). Previously you could persist a widget at `col: 99` on a 12-column grid and the kiosk would silently clip or overflow.
  - `defaultTransitionId` existence is now verified at `POST` / `PUT` / `PATCH /api/scenes` time. Previously a typo bubbled up as a SQLite foreign-key error (HTTP 500 with no field name).
  - Entity-bearing widget kinds (`weather`, `entity_tile`, `calendar`, `media_player`, `statistics`, `camera`) require `config.entity_id` to be a syntactically-valid HA entity id (`domain.object_id`). Empty strings and freeform text both reject with the offending value echoed back.
  - `PATCH /api/widgets/:id` with neither `position` nor `config` now returns 400 instead of silent no-op — agents used to think their patch landed when nothing changed.
  - Scene-level validation messages name the offending field (`name must be a non-empty string`, `layout.cols must be a positive integer`) instead of the generic `invalid scene payload`, so the model can self-correct in one round trip.
- Fix: Deleting a scene now prunes that scene's id from any display rotation that referenced it — and clears the rotation entirely if the deleted scene was the only entry. Previously a rotation pointing at a deleted scene either silently skipped the gap forever or left a dangling foreign-key-shaped pointer in the JSON column.

## 0.5.4

- Fix: Silent-data-corruption bug in MCP `patch_scene`. The `background` and `mood` fields used `z.any()` in the tool schema, which produced JSON Schema with no `"type"` annotation. Some MCP clients string-coerced those values before sending — the REST `PATCH` handler then shallow-merged the JSON-stringified literal onto disk, where the kiosk couldn't render it (mood was caught by an existing object check; background was the silent path). Two-layer fix: the schema now uses permissive `z.object().passthrough()` so MCP clients see `"type":"object"` and pass values through untouched; the REST `PATCH` handler now validates every provided field before merge (`background` shape, `mood` shape, `name`, `layout`, `typography`, `defaultTransitionId`, `floatWidgets`). Two regression tests assert a string-typed background and a malformed gradient both return `400` instead of corrupting the scene.

## 0.5.3

- Fix: Scene API now accepts `mood: { enabled: false }` without requiring `strategy` / `moodId` / `weatherEntity`. Previously a disabled mood still had to declare a (dormant) strategy, which agents tripped over when trying to disable an existing mood. The other fields are still validated when `enabled: true`.
- Fix: Sending a widget without a `config` field used to crash the repo with a `500 Internal Server Error`. The API layer now validates each widget shape and returns a clear `400` like `widgets[2].config is required (use {} for no config)`.
- Docs: Updated `docs/scene-agent.md` to lead with `PATCH /api/scenes/:id` for scene-level edits (background, typography, mood, transition) instead of the heavyweight `PUT`. Added an explicit warning about `PUT`'s widget-replace semantics — every widget you include is stored verbatim, so `config: {}` wipes the previous config. Added a "Mood: enabling and disabling" section with the correct shapes, and a "Widget shape requirements" note. Two new agent-loop recipes for "change the font" and "turn off the mood" using PATCH.

## 0.5.2

- Feat: Added `activate_scene` to the MCP surface. External agents can now push a scene live to a display — the previously documented gap that prevented an end-to-end "edit a canvas → see it on the wall" flow purely through MCP. The tool description leads with a ⚠️ warning so well-behaved clients (Claude Desktop) can surface a confirm prompt; hard-destructive tools (`delete_scene`, `delete_widget`) remain out of the MCP surface since they're data-loss operations.

## 0.5.1

- Fix: MCP `update_scene` was returning **415 Unsupported Media Type** for every payload shape. Root cause: when an LLM tool call's `payload` reached `app.inject` without an explicit content-type, light-my-request's auto-detection didn't fire and Fastify rejected the body. The MCP inject helper now defensively normalizes object payloads (and string payloads that parse as JSON) → `JSON.stringify` + `Content-Type: application/json`. Regression test added.
- Feat: New `patch_scene` MCP tool. Partial-update of scene metadata — change the background, mood, typography, name, default transition, etc. without round-tripping the entire scene including widgets. Mirrors `patch_widget` for top-level fields. Backed by a new `PATCH /api/scenes/:id` REST endpoint.
- Tweak: `update_scene` description now points at the `cosmos://docs/scene-agent` resource and lists every required top-level key, so external agents have a usable starting hint instead of just "untyped object."

## 0.5.0

- Feat: New **Agent-to-agent (MCP)** server. External agents (Claude Desktop, Cursor, etc.) can now connect to Cosmos via the Model Context Protocol to list, inspect, create, and edit scenes and canvas widgets — same execution path as the in-product agent. Off by default; enable in Settings → **Agent-to-agent (MCP)**, copy the bearer token + the Claude Desktop config snippet, and paste into your client's MCP config. Read + edit only — destructive actions (activate / delete) are never exposed.

## 0.4.5

- Feat: Each chat message now shows a timestamp ("Today at 6:32 PM" / "Yesterday at 6:32 PM" / "May 5 at 6:32 PM"), anchored to the **server's** clock instead of the browser's. The chat fetches the server time once on mount and applies the offset to every message — so timestamps stay consistent even on a wall tablet whose clock has drifted. New `GET /api/agent/time` endpoint backs it.

## 0.4.4

- Tweak: Agent chat page is now sized to fit the viewport without scrolling — calc(100dvh - 6rem) on mobile, calc(100dvh - 8rem) on desktop, with min-height dropped to 22rem so it doesn't force overflow on small phones. Header wraps title + Clear button cleanly on narrow screens, model line is smaller and breaks long ids, scroll padding tightens, and the textarea uses 16px font (prevents iOS Safari zoom-on-focus). Mobile-friendly all the way down to a 320px viewport.

## 0.4.3

- Fix: Composer no longer stretches up the page when the chat is empty. Switched the input box from a flex-row with `flex: 1` on the textarea (which was also expanding cross-axis) to a CSS grid with explicit columns; the textarea is now hard-capped at its `max-height: 10rem` regardless of how much vertical space is available.
- Feat: Empty-state hints are now **clickable starter chips** that fire the prompt to the agent immediately. The list is generated each time you open the page (or clear history) based on the time of day (morning / daytime / evening / night) and the calendar (Christmas, New Year, Valentine's, Halloween, Thanksgiving, etc.) — so the suggestions always feel current.
- Fix: The agent was inventing entity_ids (e.g. `weather.home`, `sensor.power`) it had never seen in the user's actual install, causing canvas widgets to render literal `{{ states("...") }}` text on the wall. The system prompt now has a much stronger "Entity ID Discipline" section that forbids guessing entity_ids, requires the agent to use only entities visible in the LIVE HA ENTITIES catalog (or a fresh `list_ha_entities` call), and mandates defensive defaults like `| default('—')` so unknown / unavailable states render as a dash instead of leaking the raw template.

## 0.4.2

- Feat: Action chips appear in the agent chat after any scene-mutating tool finishes (`create_scene`, `update_scene`, `patch_widget`, `update_widget_content`). One chip opens the scene in the editor; another sends it to a display — single display = one-click; multiple displays = pop-up picker. Saves the user from chasing through the chat to find the next step.

## 0.4.1

- Fix: Agent chat layout. The empty-state hint now floats centered without affecting flex sizing, and the composer stays anchored at the bottom (was sometimes growing oddly with no history). Switched from CSS Grid to flex with `min-height: 0` on the scroll area — the standard pattern for "fill remaining height; scroll the middle".
- Tweak: Renamed the agent-chat **Clear** button to **Clear history** (with a back-arrow icon) so it's findable.
- Feat: Inline "agent is working" indicator (three pulsing dots) appears in the chat while the agent is thinking or streaming a response — previously the UI looked frozen between chunks.
- Tweak: Updated the agent's system prompt to explicitly avoid technical jargon when talking to users. The agent now says "this canvas can't load images from that website" instead of "the iframe sandbox blocks cross-origin fetches", and won't echo widget IDs, JSON payloads, or contract-document references back to the user.

## 0.4.0

- Feat: **In-product agent** at `/admin/agent`. Type natural-language asks — "make me a kitchen morning tile", "change the canvas to use blue accents", "activate the Morning scene on Living Room" — and Cosmos uses an LLM via OpenRouter to inspect and modify your scenes and canvas widgets directly. Set your OpenRouter API key + model under Settings → **AI agent**. Activate / delete actions surface a confirm card in the chat before anything lands; everything else (create, patch, content updates) auto-executes. Conversation persists per-browser. The system prompt bundles the existing scene + canvas-widget agent contracts plus a live snapshot of your HA entity catalog, so the model has correct entity_ids for your specific install.

## 0.3.2

- Fix: Glitchy/slow scene transitions when switching between canvas scenes and non-canvas scenes. Two compounding leaks were forcing redundant scene re-pushes during transitions: (1) iframe-side `cosmos.subscribe(...)` extras kept growing across scene switches because they were only cleared on full display disconnect; (2) HA template subscriptions for canvas widgets that no longer existed in any scene kept firing entity-update callbacks forever. The extras store now prunes per-display on every scene push to keep only widget ids actually on the new scene, and the canvas resolver now garbage-collects subscriptions for removed widgets after every scene/widget mutation. Also added a 5-second hard cap on the canvas iframe's ready-emission loop so a torn-down iframe can't keep running its 200ms heartbeat in the detached context.

## 0.3.1

- Change: Removed the nightly 04:00 self-reload. The reload was defensive insurance against Chromium media-pipeline memory creep on long-running displays, but the cost — Android Chrome dropping fullscreen every morning, requiring a tap to recover — exceeded the benefit. Other long-running mitigations (WebSocket heartbeat + clean reconnect, minute-anchored clock, MoodLayer reuse on shared mood URLs, FitContent timeout cleanup, transform-based gradient animation) all stay in place. If memory creep ever shows up in practice this can come back as an opt-in setting.
- Feat: Per-widget update endpoints for agents — `GET /api/widgets[?scene&kind]`, `PATCH /api/widgets/:id`, and a `PUT /api/widgets/:id/content` shortcut that accepts raw HTML for canvas widgets. Lets an LLM agent update a single widget without round-tripping the whole scene. Widget ids are now also stable across saves.
- Feat: Docs page in the admin gained an in-page section filter (the entity reference is now searchable by domain) and a clipboard fallback that works under HA Ingress's plain-HTTP context.

## 0.3.0

- Fix: Canvas `cosmos.subscribe(...)` now actually delivers entity state for canvas-only entities. Previously, an entity referenced ONLY by a canvas widget (not by any other widget on the scene) had its id added to `liveEntityIds` but its actual state was never shipped to the iframe — so `update` callbacks never fired and any UI driven by `cosmos.subscribe` rendered blank. The server now snapshots every canvas-referenced entity into a new `liveEntities` field on the scene push, the display merges them into the map forwarded to canvases, and HA state changes for those entities trigger a re-push so updates flow live.

## 0.2.9

- Feat: New live **Home Assistant entities** doc in the admin Docs tab. Lists every entity Cosmos has cached from your HA install — grouped by domain, with `entity_id`, friendly name, current state, and unit/device-class. Tap "Copy markdown" to drop the whole snapshot into your agent's system prompt so it knows which entity_ids exist on your install. Snapshot regenerates each time you load the page.

## 0.2.8

- Fix: The transition-quiet window (which suppresses HA-driven re-pushes during an in-flight animation) now scales with the global transition-speed multiplier. At 5× speed a transition takes ~5.5 s; the quiet window expands to match so reactive entity churn doesn't restart juddering the animation halfway through.

## 0.2.7

- Tweak: Transition-speed multiplier now caps at 5× (was 3×), so very long, deliberate transitions are possible — useful for ambient / installation use cases.

## 0.2.6

- Feat: New **Transition speed** control under Settings. Global multiplier applied to every scene transition's `out` and `in` phases — pick a preset (Slow / Normal / Fast) or fine-tune with a slider (0.25× – 3×). 1.0× is the baked-in default; lower is snappier, higher is more cinematic. Persists across restarts and applies on the next scene change.

## 0.2.5

- Fix: Smoother animations on real Home Assistant deployments. The server's reactive scene-push debounce was 50 ms, which let chatty entities (power meters, anything with `relative_time(...)` in a template) flood the WebSocket at 20 Hz and starve the display's main thread mid-transition. Bumped to 250 ms (caps push rate at 4 Hz — still imperceptible for ambient data). On top of that, dirty-flushes are now deferred for 1.2 s after every scene change so the in-flight CSS transition has the main thread to itself. Local instances with mock data were never affected; this only matters for live HA setups.

## 0.2.4

- Feat: Scene alerts now expose a proper picker UI in the Home Assistant automation builder. Each display gets three new entities: `select.cosmos_<display>_alert_scene` (which scene to flash, populated with all your scene names), `number.cosmos_<display>_alert_dwell` (how long, in seconds), and `button.cosmos_<display>_alert_fire` (press to fire). In an automation, set the select + number, then press the button — same flow as a thermostat. Picks persist across server restarts. The legacy `notify.cosmos_<display>_show_alert` stays for direct mqtt/notify use.

## 0.2.3

- Feat: New **Docs** tab in the admin (`/admin/docs`) — bundles every reference doc shipped with Cosmos, including the agent contracts for scenes and the canvas widget. Sidebar of available docs, full markdown rendering with syntax-highlighted code blocks and tables, plus a "Copy markdown" button that drops the raw text on the clipboard so it can be pasted straight into an LLM tool's system prompt or context.
- Feat: Live preview iframes on the Overview page now load on tap (one frame at a time) and have a "pop out" button that opens the preview in a sized window. Online displays sort ahead of offline ones, and offline panels dim so the eye lands on what's live.
- Fix: Stale-cache MIME error after redeploys. Asset paths (`/_app/`, `/moods/`, anything with a file extension) now return a real 404 when missing instead of falling back to `index.html` — preventing the browser's strict-MIME check from rejecting a JS chunk that came back as HTML.

## 0.2.2

- Feat: Scene alert is now visible in Home Assistant as `notify.cosmos_<display>_show_alert` via MQTT discovery. Pass the scene name as `message` and (optional) dwell-in-seconds as `title`. Republishes after restart; existing installs may need to restart the addon for the entity to appear.

## 0.2.1

- Feat: Scene **alerts** — a new MQTT command `cosmos/<display>/scene/alert` (payload `{"scene_name":"…","dwell_ms":N,"transition_id"?:"…"}`) flips a display to a specific scene for a fixed dwell, then auto-reverts to whatever was on screen before. Server-resident timer (survives display reconnects). Manual scene changes mid-dwell cancel the auto-revert. Chained alerts preserve the original revert target so a display can't get trapped in alert mode. Parallel REST endpoint `POST /api/displays/:name/scene/alert {sceneId, dwellMs, transitionId?}` for testing/admin use.

## 0.1.23

- Fix: Scene transitions now run on Android Chrome. The display was honoring the OS `prefers-reduced-motion` preference and collapsing every transition to a 120 ms fade (which reads as instant on tablet panels). The wall kiosk now ignores that preference — configured transitions always play.

## 0.1.22

- Fix: HA media proxy now streams the upstream response body instead of buffering it. Live MJPEG camera feeds (`view: live`) work end-to-end; snapshot mode is no longer cached so each refresh shows the current frame.

## 0.1.21

- Feat: New Camera widget renders an HA `camera.*` entity snapshot with a configurable refresh cadence, plus MQTT discovery + control topics.
- Feat: Searchable entity picker (HA-style combobox) on every entity dropdown in the scene editor — type to filter by entity_id or friendly name, keyboard-navigable, ×-clear.
- Feat: Clock can now show AM/PM in 12h mode (default on; hidden in 24h).
- Feat: Widget card border-radius reads `--cosmos-widget-radius` so themes can override corner roundness scene-wide.

## 0.1.20

- Fix: Text and entity-tile widgets now auto-shrink long content to fit their cell. Wraps the rendered body in FitContent so sensor states like `input_text` values, long titles, or paragraph-length text widgets no longer overflow the widget bounds.

## 0.1.18

- Feat: Weather widget exposes the full Home Assistant weather-forecast surface — entity picker, name override, forecast type (daily/hourly/twice_daily), slot count, temperature unit, time format, secondary info attribute, and show_current/show_forecast/show_name toggles.
- Feat: Media player can now marquee-scroll long titles/artists/albums; new "Show title" toggle; "Duplicate widget" button in the scene editor.
- Perf: Display hardened for 24/7 wall use — minute-anchored clock, WebSocket app-level heartbeat with liveness timeout, gradient backgrounds animate via GPU transform (not paint), MoodLayer no longer retears the `<video>` between scenes that share a mood, FitContent retry timeouts cleared on destroy, nightly 04:00 self-reload (deferred during transitions) to dodge Chromium media-pipeline memory creep.

## 0.1.9

- Fix: media-player album art now loads in both direct-HA and add-on installs. Cosmos proxies HA media URLs through `/api/ha-media/*` so the browser doesn't need to reach HA directly. Bare entity_id values returned by some Sonos/Cast players are dropped instead of 404'ing.

## 0.1.0 - 2026-05-04

Initial release.

- Scenes with widgets (clock, weather, type-aware entity tiles), backgrounds (solid + animated gradient), per-scene typography, global safe-area padding.
- Transition engine: 6 built-in transitions, per-scene defaults, explicit overrides.
- Reactive HA entity-driven scene push.
- MQTT discovery + command topics for messages and scene activation.
- Sidebar panel admin editor at `/admin`.
