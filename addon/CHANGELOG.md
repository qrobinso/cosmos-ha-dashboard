# Changelog

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
