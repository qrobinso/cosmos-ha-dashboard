# Changelog

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
