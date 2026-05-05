# Changelog

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
