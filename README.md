# Cosmos

**A Home Assistant wall-dashboard framework for building world-class, glanceable displays.**

Hang a tablet on the wall. Point an agent at Cosmos. Tell it what you want to see — *"the time and today's weather, big; a glowing meter for solar production; tonight's calendar down the side"* — and watch it build the scene, live, on the wall. Use the built-in widgets, or have your agent design anything from your Home Assistant data: custom layouts, animation, color, whatever the glance calls for.

Cosmos is two things at once — a calm, beautiful kiosk surface tuned to be read from across a room, and an agent-friendly substrate (a clean REST/MCP API plus a sandboxed widget runtime) so the agent does the fiddly part and you just describe the result. It's built on Svelte and engineered for the hardware it actually runs on — the cheap Android tablet stuck to the wall, on 24/7 — so the kiosk stays light: compiled output, CSS-driven motion, disciplined cleanup of timers and observers. (More on that [below](#engineered-for-cheap-always-on-screens).)

**Cosmos runs as a Home Assistant app** — that's what makes the integration seamless. As an app it reads your entities through Home Assistant's own connection (no tokens to copy, no URL to configure), and it registers itself in HA as a device whose entities you drop straight into automations — switch scenes, push banners, react to which scene is showing. The admin editor mounts right into the HA sidebar. (You *can* run it standalone — see below — but the app is the path that just works.)

> Rather build it by hand? There's a drag-and-drop scene editor too. The agent is the fast path, not the only one.

---

## The idea

Most dashboards make you place widgets one by one. Cosmos flips that: you connect an agent — Claude Code, Openclaw, Hermes or anything that speaks MCP — and you talk to it.

- *"Build a kitchen scene"* → it creates the scene, picks a layout, drops in a clock + weather + the entities you mentioned.
- *"Make the power number huge and glow orange when we're importing"* → it writes a `canvas` widget — sandboxed HTML/CSS/JS with live access to your HA entities — that does exactly that.
- *"Same, but with the family calendar down the right side"* → it patches the scene.

The agent works through Cosmos's API and the `canvas` contract, with a built-in *wall-display design-principles* guide baked into its instructions — so what it produces is glanceable by construction (one focal point, distance-appropriate type, ambient not demanding), not a web page squeezed onto a TV.

You stay in the loop the whole time: every change lands on the wall in about a second, and you iterate by describing what's off.

---

## What's in the box

- **Scenes** — named layouts you switch between (a Morning scene, a Cooking overlay, an Away scene). Each has its own background, typography, widget grid, default transition, and ambient mood.
- **Built-in widgets** — `clock`, `weather`, `entity_tile`, `calendar`, `media_player`, `statistics`, `text`, `camera`.
- **The `canvas` widget** — the escape hatch, and where agents shine: sandboxed HTML/CSS/JS with live HA data. Jinja templates inside the content (`{{ states("sensor.foo") }}`) are rendered by Home Assistant itself; a read-only `cosmos` JS bridge exposes entity subscriptions, calendar events, an allowlisted `fetch`, and scene styling tokens (font, color, size). Anything you can describe, an agent can build here.
- **Backgrounds** — solid or animated gradient (mesh / linear / radial). Gradients can adapt to the time of day (via `sun.sun`) or to colors pulled live from album art and canvas widgets.
- **Auto-contrast text** — opt in per scene and widget text flips to black or white based on the background's luminance, so it stays legible on any palette. Or set an explicit text color.
- **Transitions** — six built-in scene transitions, a per-scene default, per-scene-pair overrides. Choreography runs client-side; the server resolves which one applies.
- **Moods** — an optional screen-blended looping video atmosphere per scene (pick one, rotate by time of day, or follow the weather).
- **Message overlays** — push a toast / banner to any display from a Home Assistant automation.
- **Home Assistant integration** — each display appears in HA as a device with entities you drop straight into automations (switch scenes, show messages, read the current scene, check online state) — no MQTT-publish boilerplate.
- **Visual editor** — a drag-and-drop scene builder at `/admin`, mobile + desktop, that mounts into the HA sidebar. The manual path for when you don't want an agent in the loop. A live hover preview shows you the real render of any scene.
- **Installable HA app** — Supervisor auto-discovery, an Ingress sidebar panel, multi-arch Docker images.

---

## Engineered for cheap, always-on screens

The display Cosmos runs on is usually an $80 Android tablet stuck to a wall, powered on around the clock. The framework is built around that constraint, not in spite of it:

- **Svelte, compiled.** The display app is SvelteKit + `adapter-static` — it ships to the device as plain HTML/CSS/JS, no virtual-DOM runtime, no server process on the tablet. Small bundle, small heap.
- **No JS in the render loop.** Every animation — gradient drift, scene transitions, the floating-widget bob, the mood-video blend — is pure CSS (`@keyframes`, `transition`, `background-position`, `mix-blend-mode`). The GPU does the moving; the main thread stays free for the next scene push. `requestAnimationFrame` is used only where CSS genuinely can't express the effect.
- **Disciplined cleanup.** Components disconnect their `ResizeObserver`/`MutationObserver`s, cancel pending `requestAnimationFrame`s, and clear their timers on unmount. The clock ticks on a chained `setTimeout` aligned to the next second/minute (not `setInterval`), so a device sleep/wake resyncs cleanly instead of firing a backlog of catch-up callbacks. The transition engine is a state machine that tears its DOM down when a transition ends. Canvas iframes re-mount only when their HTML changes — live entity updates arrive as `postMessage`, not re-renders — which is why the docs steer you to one canvas per scene.
- **The kiosk is a passive receiver.** It polls nothing: the server pushes scene state over a WebSocket only when something actually changes, and only to the displays that care — an "interest set" short-circuits Home Assistant state changes that no on-screen widget reads. The socket reconnects with exponential backoff (capped at 30 s) if it drops.
- **Server-side guardrails.** Calendar windows and weather forecasts are cached per `(entity, window)` for a few minutes with concurrent-call coalescing, so a chatty canvas on a tick — or a busy HA install — can't snowball into an RPC storm. Process-level `unhandledRejection` / `uncaughtException` guards keep a stray library rejection from taking the app down.
- **Motion that respects the device.** `prefers-reduced-motion` disables the floating-widget animation and the page-load reveals, and pauses the mood video on its first frame. (Scene transitions deliberately ignore it — Android Chrome's reduced-motion default would otherwise collapse every transition to a 120 ms fade on a passive kiosk that isn't a general-purpose web page.)

---

## How it works

Cosmos is two surfaces backed by one small server:

- **The kiosk** (`/`) — the wall display. A tablet opens this URL, names itself once, and from then on receives scene state over a WebSocket. Everything here is tuned to be calm and beautiful: animated gradients, bundled fonts, transitions, the mood video layer. This is what hangs on your wall.
- **The admin editor** (`/admin/*`) — a modern dark UI for building scenes, managing displays, tweaking settings, and (optionally) chatting with a built-in agent. Mobile + desktop friendly. In the HA app it mounts as a sidebar panel via Ingress.
- **The server** — Node + TypeScript + Fastify. Holds scene config in SQLite, talks to Home Assistant over its WebSocket API (subscribing to entity changes so widgets stay live), optionally talks to MQTT for the automation entities + command topics, exposes a REST API and an MCP endpoint for agents, and pushes scene state to every connected display.

```
┌────────────┐   WebSocket    ┌───────────────┐   HA WS API   ┌───────────────────────┐
│  Tablet(s) │ ◀────────────▶ │ Cosmos server  │ ◀───────────▶ │ Home Assistant        │
│  (kiosk /) │  scene state   │  (Fastify +    │  entity feed  │  (entities, calendar,  │
└────────────┘                │   SQLite)      │               │   templates, …)        │
                              │                │   MQTT (opt)  └───────────────────────┘
┌────────────┐   REST + WS    │  REST API      │ ◀───────────▶ ┌───────────────────────┐
│  Admin UI  │ ◀────────────▶ │  + /mcp        │  discovery +  │ MQTT broker           │
│ (/admin/*) │                │                │  commands     └───────────────────────┘
└────────────┘                └───────┬───────┘
                                      │ /mcp (bearer-token)
                                      ▼
                              ┌───────────────┐
                              │ Your agent    │  "build me a kitchen scene with…"
                              │ (Claude Code, │
                              │  Cursor, …)   │
                              └───────────────┘
```

Without `HA_URL` / `HA_TOKEN`, Cosmos runs against mock entity data so you can try it out. Without an MQTT broker, scenes/widgets/transitions all work — only the automation entities and command topics are unavailable. Inside the HA app, both connections wire up automatically (HA via the Supervisor token, MQTT via the bundled Mosquitto app if you have it).

---

## Get started

### 1. Install the Home Assistant app

> Home Assistant renamed "add-ons" to "apps" in 2026. Older HA versions use the **Settings → Add-ons** path; the steps below use the current terminology.

1. In Home Assistant: **Settings → Apps → App Store → ⋮ (top right) → Repositories**. Add:

   ```
   https://github.com/qrobinso/cosmos-ha-dashboard
   ```

2. Cosmos appears under **Local apps**. Open it and click **Install**, then **Start**.
3. *(Optional but recommended)* Install the **Mosquitto broker** app if you don't already have one — Cosmos auto-discovers it (no config) and uses it for the automation entities + message overlays.
4. A **Cosmos** entry appears in the HA sidebar — that's the admin editor.

Full app docs, options, and the MQTT entity reference: [`addon/DOCS.md`](addon/DOCS.md).

### 2. Connect your agent (the fast path)

1. Open the **Cosmos** sidebar panel → **Settings → Agent-to-agent (MCP)**. Toggle **Enable MCP server** and generate a token. Cosmos shows you the endpoint URL (typically `http://<your-host>:8099/mcp`).
2. Add it to your agent. For Claude Code:

   ```bash
   claude mcp add cosmos --transport http http://<your-host>:8099/mcp \
     --header "Authorization: Bearer <token>"
   ```

   (or the equivalent in Cursor / whatever you use — it's a standard HTTP MCP server, bearer-token gated, read + edit only).
3. Talk to it:

   > *"In Cosmos, create a scene called Kitchen with a big clock, today's weather, and a canvas widget showing solar production as a number that glows orange when we're importing power. Make the background a warm animated gradient."*

   The agent reads Cosmos's tool catalog plus the bundled design + canvas contracts and builds it. Iterate by describing what to change.

Details and the full agent workflow (including the paste-instead-of-MCP option): [`docs/getting-started-with-agents.md`](docs/getting-started-with-agents.md). The contracts agents follow: [`docs/scene-agent.md`](docs/scene-agent.md), [`docs/canvas-widget-agent.md`](docs/canvas-widget-agent.md), [`docs/wall-display-principles.md`](docs/wall-display-principles.md), [`docs/design-pack-authoring.md`](docs/design-pack-authoring.md).

> **No external agent?** The admin UI has a built-in chat panel that does the same thing — type what you want, it builds the scene. No MCP setup required. It's the same tool catalog under the hood.

### 3. Connect a tablet

Open `http://<your-HA-IP>:8099/` on the tablet's browser. The first time, you'll be asked to name the display (e.g. "Living Room"); after that it auto-connects. Assign it a scene from the admin editor — Displays → assign — and it's live. Any device with a modern browser that can stay on works (a cheap Android tablet in kiosk mode, a Raspberry Pi in Chromium kiosk, …).

### 4. Run it standalone (optional)

Cosmos is a standard Node app — the server serves the built display via `@fastify/static`:

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

`HA_URL`/`HA_TOKEN` and `MQTT_URL` are optional — drop them for mock data and no MQTT.

For local development:

```bash
npm install
npm test                 # server test suite (Vitest)
npm run dev              # ← both server + display, with HMR. Open http://localhost:5173
```

`npm run dev` runs the Fastify server (`tsx watch`, port 8099) and the Vite dev server (port 5173) concurrently. **Develop against `:5173`** — Vite proxies `/api` and `/ws` to `:8099`, so the kiosk + admin both work, and Svelte components hot-reload without a full page refresh. Server-side TypeScript changes auto-restart the Node process, and the kiosk's WS reconnect logic re-syncs without a reload.

If you accidentally hit `:8099` in dev, the server **redirects you to `:5173`** (the Fastify static handler would otherwise serve a stale prebuilt bundle whose chunk hashes don't match the current source — the canonical "404 on `_app/immutable/...` after a rebuild" failure mode). The redirect only fires when `COSMOS_DEV_VITE_URL` is set, which the `dev:server` script does for you.

If you want to run the two pieces separately (e.g. for log inspection), `npm run dev:server` and `npm run dev:display` still work in independent terminals.

Architecture and conventions: [`CLAUDE.md`](CLAUDE.md), [`server/CLAUDE.md`](server/CLAUDE.md), [`display/CLAUDE.md`](display/CLAUDE.md).

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

There's also a server-side timed **alert** (switch to a scene, auto-revert after N seconds) and raw MQTT command topics if you'd rather skip the discovery entities — see [`addon/DOCS.md`](addon/DOCS.md).

---

## FAQ

**Do I need an agent to use Cosmos?**
No. The drag-and-drop editor at `/admin` builds scenes by hand, and the built-in widgets cover the common cases. The agent is the fast path — especially for `canvas` widgets, where "describe it" beats "code it." You can also use the built-in chat panel without wiring an external agent.

**Do I need Home Assistant?**
To try it, no — without `HA_URL`/`HA_TOKEN` it runs on mock entity data so you can see how it behaves. For anything useful, point it at a real HA instance (or install it as the HA app, which wires that up for you).

**Do I need MQTT?**
No. Scenes, widgets, transitions, moods, backgrounds, and canvas widgets all work without it. MQTT only powers the per-display HA entities (for automations) and the message-overlay command topics. In the HA app, install the Mosquitto broker app and Cosmos finds it automatically.

**What can the agent actually do — and can it break Home Assistant?**
It can create/edit/delete scenes and widgets, author canvas widgets, and read your entities and calendars. It **cannot** turn devices on/off or call HA services — the canvas API is read-only, and the MCP surface is read + edit on Cosmos config only. Scene switching from HA goes the other direction: HA tells Cosmos what to show.

**How many widgets / scenes can I have?**
Plenty of scenes, plenty of widgets per scene — but **one `canvas` widget per scene** is the recommendation. Each canvas is a sandboxed iframe, and several on a tablet running 24/7 add up on memory and CPU. The other widget kinds are cheap.

**The text on my widgets is hard to read against a light background.**
Turn on **Auto-contrast text** in the scene's Background settings — widget text switches to black or white based on the background's luminance. Or set an explicit **Text color** under Typography (that wins). Canvas widgets pick it up too, via the `--cosmos-fg` CSS variable.

**Can I show a camera feed in a canvas widget?**
No — the canvas iframe is sandboxed at a null origin and can't load camera-proxy URLs. Use the native `camera` widget. For conditional visibility, put a `camera` widget and a `canvas` overlay at the same grid position on a `floatWidgets: true` scene and have the canvas hide/show itself.

**Weather forecasts (high/low, multi-day) aren't showing up.**
Home Assistant removed forecast attributes from `weather.*` entities in 2024.4+ — they now require a `weather.get_forecasts` service call, which canvases can't make. Use the native `weather` widget for forecast UI, or pull forecast data via the canvas `cosmos.fetch` (Open-Meteo is allowlist-friendly), or have HA populate a template sensor from a service-call automation.

**Where does my configuration live?**
In SQLite at `/data/cosmos.db` inside the HA app (HA persists `/data` across restarts and updates). Standalone, it's wherever you point `DB_PATH`.

**Something's wrong — where do I look?**
The server logs (in the HA app, the app's **Log** tab; standalone, on stdout). Raise `log_level` for more detail. Issues and feature requests: <https://github.com/qrobinso/cosmos-ha-dashboard>.

---

## Project layout

- `server/` — Node + TypeScript + Fastify + `ws` + `better-sqlite3`. Scene config, HA/MQTT integration, WebSocket hub, REST API, the `/mcp` endpoint. See [`server/CLAUDE.md`](server/CLAUDE.md).
- `display/` — SvelteKit + adapter-static. The kiosk (`/`) and the admin editor (`/admin/*`). Built artifacts are served by the server. See [`display/CLAUDE.md`](display/CLAUDE.md).
- `addon/` — Home Assistant app packaging (`config.yaml`, `Dockerfile`, `DOCS.md`, changelog, translations).
- `docs/` — user + agent guides. `docs/superpowers/specs/` holds design specs; `docs/superpowers/plans/` holds implementation plans.
- `CLAUDE.md` — architecture overview, conventions, and the project roadmap.

## Contributing

Test-driven development (write the failing test first), conventional commits (`feat|fix|chore|refactor(scope): subject`), frequent small commits. Run `npm test` before pushing. Conventions and the current roadmap are in [`CLAUDE.md`](CLAUDE.md).

## Support

Issues, questions, and feature requests: <https://github.com/qrobinso/cosmos-ha-dashboard>.
