# Cosmos Dashboard

**A beautiful, glanceable wall dashboard for Home Assistant.** Design scenes — backgrounds, widgets, typography, transitions — from inside Home Assistant, then point any tablet or spare screen at Cosmos to run it as a kiosk. Switch scenes from HA automations, push message banners, let an LLM agent author custom widgets for you.

Cosmos is built to look gorgeous from across a room and stay calm doing it: CSS-driven animated gradient backgrounds, curated typography, a transition engine, and an optional looping-video "mood" layer. The admin side is a modern, mobile-friendly editor that mounts straight into the HA sidebar.

---

## What you get

- **Scenes** — named layouts you switch between. Each scene has its own background, typography, widget grid, default transition, and mood.
- **Widgets** — `clock`, `weather`, `entity_tile`, `calendar`, `media_player`, `statistics`, `text`, `camera`, and the freeform `canvas` widget (sandboxed HTML/CSS/JS with live HA data).
- **Backgrounds** — solid color or animated gradient (mesh / linear / radial). Gradients can auto-adapt to the time of day (via `sun.sun`) or to colors pulled live from album art / canvas widgets.
- **Auto-contrast text** — opt in per scene and widget text flips to black or white based on the background's luminance, so it stays legible on any palette. Or set an explicit text color under Typography.
- **Transitions** — six built-in scene transitions, a per-scene default, and per-scene-pair overrides. The choreography runs client-side; the server resolves which transition applies.
- **Moods** — an optional screen-blended looping video layer per scene. Strategies: pick one manually, rotate by time of day, or follow the weather.
- **Message overlays** — push a toast / banner to any display from an HA automation (requires MQTT).
- **Home Assistant integration** — each display shows up in HA as a device with entities you can drop into automations (switch scenes, show messages, read the current scene, check online state). No MQTT-publish boilerplate.
- **LLM agent authoring** — point Claude Code, Cursor, OpenCode, or any agent at the bundled contract docs and have it write canvas widgets that read your real entities. Works via copy-paste or by the agent calling the Cosmos REST API directly.
- **Installable HA app** — ships as a Home Assistant app (formerly "add-on") with Supervisor auto-discovery, an Ingress sidebar panel, and multi-arch Docker images.

---

## How it works

Cosmos is two surfaces backed by one small server:

- **The kiosk** (`/`) — the wall display. A tablet opens this URL, names itself once, and from then on receives scene state over a WebSocket. Everything here is tuned to be calm and beautiful: animated gradients, bundled fonts, transitions, the mood video layer. This is what hangs on your wall.
- **The admin editor** (`/admin/*`) — a modern dark UI for building scenes, managing displays, and tweaking settings. Mobile + desktop friendly. In the HA app it mounts as a sidebar panel via Ingress.
- **The server** — Node + TypeScript + Fastify. Holds scene config in SQLite, talks to Home Assistant over its WebSocket API (subscribing to entity changes so widgets stay live), optionally talks to MQTT for the automation entities and command topics, and pushes scene state to every connected display.

```
┌────────────┐   WebSocket    ┌───────────────┐   HA WS API   ┌───────────────────────┐
│  Tablet(s) │ ◀────────────▶ │ Cosmos server  │ ◀───────────▶ │ Home Assistant        │
│  (kiosk /) │  scene state   │  (Fastify +    │  entity feed  │  (entities, calendar,  │
└────────────┘                │   SQLite)      │               │   templates, …)        │
                              │                │   MQTT (opt)  └───────────────────────┘
┌────────────┐   REST + WS    │                │ ◀───────────▶ ┌───────────────────────┐
│  Admin UI  │ ◀────────────▶ │                │  discovery +  │ MQTT broker           │
│ (/admin/*) │                └───────────────┘  commands      └───────────────────────┘
└────────────┘
```

Without `HA_URL` / `HA_TOKEN`, Cosmos runs against mock entity data so you can try it out. Without an MQTT broker, scenes/widgets/transitions all work — only the automation entities and command topics are unavailable. Inside the HA app, both connections are wired up automatically (HA via the Supervisor token, MQTT via the bundled Mosquitto app if you have it).

---

## Getting started

### Option A — install as a Home Assistant app (recommended)

> Home Assistant renamed "add-ons" to "apps" in 2026. Older HA versions use the **Settings → Add-ons** path; the steps below use the current terminology.

1. In Home Assistant: **Settings → Apps → App Store → ⋮ (top right) → Repositories**. Add:

   ```
   https://github.com/qrobinso/cosmos-ha-dashboard
   ```

2. Cosmos appears under **Local apps**. Open it and click **Install**.
3. *(Optional but recommended)* Install the **Mosquitto broker** app if you don't already have one. Cosmos auto-discovers it — no config needed — and uses it for the automation entities + message overlays.
4. Start Cosmos. A **Cosmos** entry appears in the HA sidebar — that's the admin editor. Create your first scene there.
5. Open `http://<your-HA-IP>:8099/` on a tablet. Name the display (e.g. "Living Room"). Assign it a scene from the admin editor. Done.

Full app docs, options, and the MQTT entity reference: [`addon/DOCS.md`](addon/DOCS.md).

### Option B — run it yourself (Docker / Node)

Cosmos is a standard Node app. Build the display, then run the server (which serves the built display via `@fastify/static`):

```bash
npm install
npm run build
DB_PATH="$(pwd)/data/cosmos.db" \
  HA_URL="http://homeassistant.local:8123" \
  HA_TOKEN="<long-lived-access-token>" \
  MQTT_URL="mqtt://homeassistant.local:1883" \
  npm --workspace server start
# → http://localhost:8099  (admin at /admin, kiosk at /)
```

`HA_URL`/`HA_TOKEN` and `MQTT_URL` are all optional — drop them and Cosmos uses mock data and disables MQTT-dependent features.

### Option C — local development

```bash
npm install
npm test                 # server test suite (Vitest)
npm run dev:server       # http://localhost:8099
npm run dev:display      # http://localhost:5173 (proxies /api + /ws to 8099)
```

The dev display has HMR; the dev server restarts on change. Architecture and conventions are in [`CLAUDE.md`](CLAUDE.md), [`server/CLAUDE.md`](server/CLAUDE.md), and [`display/CLAUDE.md`](display/CLAUDE.md).

---

## Driving Cosmos from Home Assistant

When MQTT is connected, Cosmos publishes HA discovery payloads, so each display becomes a HA **device** with these entities:

| Entity | Type | Use in automations |
|---|---|---|
| `select.<display>_active_scene` | Select | **Select option** → switch the display to that scene |
| `notify.<display>_show_message` | Notify | **Notification** → push a banner (title + message) |
| `button.<display>_dismiss_message` | Button | **Press** → clear any visible banner |
| `button.<display>_last_scene` | Button | **Press** → switch back to the previously-active scene |
| `sensor.<display>_scene` | Sensor | Trigger / condition on the current scene name |
| `binary_sensor.<display>_online` | Connectivity | Trigger / condition on display online state |

Example — flip the Kitchen display to a "Cooking" scene when the oven turns on:

```yaml
trigger:
  platform: state
  entity_id: switch.oven
  to: 'on'
action:
  service: select.select_option
  target:
    entity_id: select.kitchen_active_scene
  data:
    option: Cooking
```

There's also a server-side timed **alert** (switch to a scene, auto-revert after N seconds) and raw MQTT command topics if you'd rather not use the discovery entities — see [`addon/DOCS.md`](addon/DOCS.md).

---

## Authoring widgets with an LLM agent

The `canvas` widget runs sandboxed HTML/CSS/JS that you — or an agent — write. Jinja templates inside the content (`{{ states("sensor.foo") }}`) are rendered by Home Assistant itself, so you get full HA template compatibility. Inside the iframe a small read-only `cosmos` JS bridge exposes live entity subscriptions, calendar events, an allowlisted `fetch`, and scene styling tokens (font, colors, size).

To have an agent build one for you, point it at:

- [`docs/getting-started-with-agents.md`](docs/getting-started-with-agents.md) — the workflow (paste flow vs. direct-send flow)
- [`docs/canvas-widget-agent.md`](docs/canvas-widget-agent.md) — the contract an agent follows when generating canvas content
- [`docs/canvas-widget.md`](docs/canvas-widget.md) — the human-facing reference
- [`docs/scene-agent.md`](docs/scene-agent.md) — how an agent produces a whole scene
- [`docs/design-pack-authoring.md`](docs/design-pack-authoring.md) — design packs (a shared visual-taste layer agents can pull from)

If you run an external agent that speaks MCP, Cosmos has an optional Model Context Protocol HTTP server at `/mcp` (bearer-token gated, off by default) exposing the same tools the in-product agent uses.

---

## FAQ

**Do I need Home Assistant to try Cosmos?**
No — without `HA_URL`/`HA_TOKEN` it runs on mock entity data. You won't see your real devices, but you can build scenes and see how everything behaves. For anything useful, point it at a real HA instance.

**Do I need MQTT?**
No. Scenes, widgets, transitions, moods, backgrounds, and the canvas widget all work without it. MQTT only powers the per-display HA entities (the ones you use in automations) and the message-overlay command topics. Inside the HA app, install the Mosquitto broker app and Cosmos finds it automatically.

**What kind of device should I use for the wall display?**
Anything with a modern browser that can stay on. A cheap Android tablet in kiosk mode is the common choice; a Raspberry Pi in a Chromium kiosk also works. Just open `http://<HA-IP>:8099/` and name the display.

**How many widgets / scenes can I have?**
Plenty of scenes, plenty of widgets per scene — but **one `canvas` widget per scene** is the recommendation. Each canvas is a sandboxed iframe, and several of them on a tablet running 24/7 add up on memory and CPU. The other widget kinds are cheap.

**The text on my widgets is hard to read against a light background.**
Turn on **Auto-contrast text** in the scene's Background settings — widget text will switch to black or white based on the background's luminance. Or set an explicit **Text color** under Typography (that wins over auto-contrast). Canvas widgets pick this up too, via the `--cosmos-fg` CSS variable.

**Can I show a camera feed in a canvas widget?**
No — the canvas iframe is sandboxed at a null origin and can't load camera-proxy URLs. Use the native `camera` widget. For conditional visibility, put a `camera` widget and a `canvas` overlay at the same grid position on a `floatWidgets: true` scene and have the canvas hide/show itself.

**Weather forecasts (high/low, multi-day) aren't showing up.**
Home Assistant removed forecast attributes from `weather.*` entities in 2024.4+ — they now require a `weather.get_forecasts` service call, which canvases can't make. Use the native `weather` widget for forecast UI, or pull forecast data via the canvas `cosmos.fetch` (Open-Meteo is allowlist-friendly), or have HA populate a template sensor from a service-call automation.

**Where does my configuration live?**
In SQLite at `/data/cosmos.db` inside the HA app (HA persists `/data` across restarts and updates). Running standalone, it's wherever you point `DB_PATH`.

**Does Cosmos modify my Home Assistant entities?**
No. The canvas API is read-only — it can describe state but not change it (there's no service-call primitive). Scene switching from HA goes the other direction: HA tells Cosmos what to show.

**How do I update the HA app?**
When a new version is published, the app page in HA shows an update. Your data persists across updates.

**Something's wrong — where do I look?**
The server logs (in the HA app, under the app's **Log** tab; standalone, on stdout). Raise `log_level` for more detail. Issues and feature requests: <https://github.com/qrobinso/cosmos-ha-dashboard>.

---

## Project layout

- `server/` — Node + TypeScript + Fastify + `ws` + `better-sqlite3`. Scene config, HA/MQTT integration, WebSocket hub, REST API. See [`server/CLAUDE.md`](server/CLAUDE.md).
- `display/` — SvelteKit + adapter-static. The kiosk (`/`) and the admin editor (`/admin/*`). Built artifacts are served by the server. See [`display/CLAUDE.md`](display/CLAUDE.md).
- `addon/` — Home Assistant app packaging (`config.yaml`, `Dockerfile`, `DOCS.md`, changelog, translations).
- `docs/` — user + agent guides. `docs/superpowers/specs/` holds design specs; `docs/superpowers/plans/` holds implementation plans.
- `CLAUDE.md` — architecture overview, conventions, and the project roadmap.

## Contributing

The codebase follows test-driven development (write the failing test first), conventional commits (`feat|fix|chore|refactor(scope): subject`), and frequent small commits. Run `npm test` before pushing. Conventions and the current roadmap are in [`CLAUDE.md`](CLAUDE.md).

## Support

Issues, questions, and feature requests: <https://github.com/qrobinso/cosmos-ha-dashboard>.
