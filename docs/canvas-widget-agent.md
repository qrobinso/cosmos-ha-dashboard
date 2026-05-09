# Canvas widget — agent contract

> *This file is for an LLM. If you're a human looking for setup steps, see [getting-started-with-agents.md](./getting-started-with-agents.md).*

This document is intended to be pasted into an LLM agent's system prompt or pulled in as a tool/reference document. It describes exactly what the agent should output when generating canvas widget content for Cosmos.

For the surrounding scene shape (background, typography, layout, publishing flow), pair this with [`scene-agent.md`](./scene-agent.md). The typical flow is: design the scene shape from `scene-agent.md`, then author the `canvas.config.content` field using this guide, then publish via the API.

## Contract

You are emitting a complete HTML body for a Cosmos canvas widget. Output ONLY the HTML; no markdown fences, no preamble, no closing chatter. The output should be ready to drop into the widget's `content` field.

Example completion:

```html
<div style="display:grid;place-items:center;width:100%;height:100%;font-family:var(--cosmos-font-family,system-ui),system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f5f5f5">
  <div>{{ states("sensor.power") }} W</div>
</div>
```

Do **not** wrap the output in `<html>` or `<body>` tags — your output is concatenated with a Cosmos-injected bridge script and inserted into an iframe `srcdoc`.

## What's available

### Templates (server-side, evaluated by HA)

Wrap any expression in `{{ ... }}`. Standard Home Assistant Jinja:

- `states("entity_id")` — current state as string
- `state_attr("entity_id", "attr")` — attribute value (any type)
- `is_state("entity_id", "value")` — boolean
- `relative_time(states.X.last_changed)` — humanised duration
- `now()`, `as_timestamp(...)`, `today_at(...)` — time helpers
- `{% if %}`, `{% for %}` — full control flow

Cosmos automatically subscribes to entities your templates touch and re-renders the canvas when they change.

**Finding the right entity to template against.** Real HA installs have hundreds-to-thousands of entities — never guess `sensor.power` and hope. Discover before you write:

- `GET /api/ha/entities/summary` — `{total, domains, deviceClasses}`. Tiny. Tells you what's available without reading the full list.
- `GET /api/ha/entities?domain=sensor&search=kitchen` — narrow by `domain`, `device_class`, and a case-insensitive `search` substring (matches `entity_id` + `friendly_name`). Add `limit=N` to cap responses.
- Over MCP: `summarize_ha_entities` and `list_ha_entities({domain?, device_class?, search?, limit?})`.

A canvas template that references an entity that doesn't exist in this install will render `unknown` (or your `| default('—')`) — the wall will look broken. Verify discovery results before committing the template.

### JS API (in-iframe, exposed as `window.cosmos`)

```ts
cosmos.ready: Promise<void>
cosmos.size: { w: number; h: number }
cosmos.scene: { id: string; name: string }
cosmos.font: { family: string; scale: number }
cosmos.version: string

cosmos.entity(id: string): EntityState | null
cosmos.subscribe(id: string, cb: (e: EntityState) => void): () => void

cosmos.fetch(url: string, init?: { method?: string; headers?: Record<string,string>; body?: string }): Promise<CosmosResponse>
cosmos.reportColors(colors: string[]): void

type EntityState = { entity_id: string; state: string; attributes: Record<string, unknown> }
type CosmosResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
```

Subscribe is the live binding; reach for it when an animation needs to react to state.

### Outbound fetches (`cosmos.fetch`)

The iframe sandbox blocks normal `window.fetch` for cross-origin requests, so canvases use `cosmos.fetch` instead. The display's parent context performs the request on the iframe's behalf, gated by a per-server **allowlist** the user manages at *Admin → Settings → Canvas fetch*.

- **Default policy is deny.** A fresh install starts in `allowlist` mode with an empty list, so `cosmos.fetch` rejects until the user adds hostnames.
- **Allowlist matches host + subdomains.** An entry `example.com` matches `example.com` and `api.example.com`. Schemes / ports / paths are ignored.
- **`http(s)` only.** Other protocols (file:, ws:, data:) are rejected.
- **No credentials.** Cookies and `Authorization` from the parent are never sent. Pass any auth header via `init.headers`.
- **Response cap.** Bodies above ~2 MB are rejected; long-running requests time out after 15s.
- **Use `setInterval` to poll.** Timers work normally inside the iframe.

```js
async function loadFeed() {
  try {
    const res = await cosmos.fetch('https://api.example.com/headlines.json');
    if (!res.ok) return;
    const json = await res.json();
    render(json.items);
  } catch (err) {
    // err.message starts with 'cosmos.fetch:' for policy/transport failures.
    console.warn(err);
  }
}
loadFeed();
setInterval(loadFeed, 5 * 60 * 1000);
```

If the user hasn't added the host to the allowlist, the promise rejects with a message that names the missing host. Surface that error in the UI rather than silently retrying — the user needs to act.

### Reporting palette colors (`cosmos.reportColors`)

If your canvas has dominant colors worth contributing to the scene's gradient — say, a glowing accent or a hero image — report them with `cosmos.reportColors([...])`. The visual effect activates when the scene's gradient has `adaptive_colors: true`; if it doesn't, the call still records the palette server-side (the agent can read it via `GET /api/displays/<name>/palette`) but the wall's gradient won't track it.

**When you author a canvas that calls `cosmos.reportColors`, set `adaptive_colors: true` on the scene's gradient as part of the same change** so the user sees the effect without a follow-up step. A `gradient` background is required — adaptive_colors is a no-op on `solid` backgrounds. Either author the scene with a gradient + `adaptive_colors: true` from the start, or call `patch_scene` to flip the flag while you're updating the canvas. See scene-agent.md → Background → `adaptive_colors`.

- Pass 1–5 `#rrggbb` strings. Anything else is dropped at the parent.
- Pass `[]` to clear your contribution.
- Call as often as you like; the server's change detector dedupes.

```js
cosmos.reportColors(['#ff8c4d', '#3d2a1f', '#ffd6a8']);
```

### Resize event

`window.addEventListener('cosmos:resize', () => recompute())` fires when `cosmos.size` changes.

### Scene tokens (CSS custom properties — preferred)

Cosmos sets these on `:root` and updates them live whenever the scene changes. Use `var(...)` instead of reading `cosmos.font.*` from JS — no listeners, no race with `cosmos.ready`.

| Variable | Source | Typical use |
|---|---|---|
| `--cosmos-font-family` | scene's `typography.font_family` | `font-family: var(--cosmos-font-family, system-ui), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| `--cosmos-font-scale` | scene's `typography.font_scale` | `font-size: calc(1rem * var(--cosmos-font-scale, 1))` |
| `--cosmos-bg` | scene background — solid color, or first stop of a gradient | `background: var(--cosmos-bg, transparent)` for blend-in surfaces |
| `--cosmos-w` / `--cosmos-h` | iframe pixel size | `clamp()`/`min()` calculations |
| `--cosmos-scene-id` / `--cosmos-scene-name` | scene metadata as strings | `[data-scene]` selectors, or `content: var(...)` in pseudo-elements |

**Rule of thumb:** every canvas should set `font-family: var(--cosmos-font-family, system-ui), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` on its root element so the typography matches the rest of the scene. Override locally for headlines/numerals if you want a typographic accent — never override globally with a hardcoded family.

**Why the long chain after `var(...)`?** Cosmos always sets `--cosmos-font-family`, so the `system-ui` *inside* `var()` only fires if the variable were undefined — which it never is. But the canvas iframe is sandboxed (`sandbox="allow-scripts"`, null origin) and can't load Cosmos's bundled `@fontsource` fonts, so the named scene font (e.g. `"Space Grotesk"`) usually fails to resolve inside the iframe. Without a real fallback **after** the `var()`, the browser falls through to its ultimate default — Times New Roman on most platforms — which looks broken next to the rest of the scene. The trailing `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` gives the browser a real sans-serif to land on.

## Naming a canvas

Canvas widgets accept an optional `config.name` — a short user-readable label the user can also set in the editor. Always set it when you create or duplicate a canvas. It's how the user (and you, on the next turn) refer back to this widget without an opaque UUID.

```json
{
  "kind": "canvas",
  "position": { "col": 1, "row": 1, "w": 12, "h": 8 },
  "config": {
    "name": "news-headlines",
    "content": "<div>…</div>"
  }
}
```

Convention: short kebab-case strings tied to purpose (`news-headlines`, `kitchen-power`, `garden-cam`). Names are not unique — two scenes can each have a canvas named `power`. When the user is ambiguous, list candidates and ask.

## Updating an existing canvas

When the user asks you to *change* a canvas already on a scene (rather than create a new one), use the per-widget endpoints. They let you patch one widget without round-tripping the whole scene.

### 1. Find the widget id

```bash
# All widgets across all scenes
GET /api/widgets

# Filter by scene name + kind — usually what you want
GET /api/widgets?scene=Kitchen&kind=canvas

# Filter by user-assigned name — best when the user says "edit the news-headlines canvas"
GET /api/widgets?kind=canvas&name=news-headlines
```

Each entry is `{ id, sceneId, sceneName, kind, name, position, config }`. The widget `id` is stable across saves — once you have it, you can hold onto it. `name` mirrors `config.name`, the optional label the user sets in the editor; matching is case-insensitive and exact.

### 2. Replace the canvas content (raw HTML, smallest request)

```bash
PUT /api/widgets/<widget-id>/content
Content-Type: text/html

<div style="...">{{ states("sensor.power") }} W</div>
```

Or as JSON if your client doesn't do `text/html` cleanly:

```bash
PUT /api/widgets/<widget-id>/content
Content-Type: application/json

{ "content": "<div>...</div>" }
```

This shortcut only works on `kind: canvas` — other widget kinds get a 400.

### 3. Or patch any config field with a partial update

```bash
PATCH /api/widgets/<widget-id>
Content-Type: application/json

{ "config": { "content": "<div>...</div>", "name": "kitchen-power" } }
```

`config` is shallow-merged — keys you don't include are left alone. `position` can also be patched (e.g. to resize: `{ "position": { "col": 1, "row": 1, "w": 6, "h": 4 } }`).

Both endpoints push the updated scene to every display showing it, so the wall display refreshes within a second.

### Typical agent loop

1. `GET /api/widgets?scene=<name>&kind=canvas` → pick the target widget's `id`
2. `PUT /api/widgets/<id>/content` with the new HTML

Two requests, no scene round-trip, no widget-id management.

## What's forbidden

- `<script src="https://...">` — cross-origin scripts won't load. Inline scripts only.
- `fetch()` to Cosmos's API or to HA — origin is `null`; same-origin requests are blocked. Public CORS-permissive URLs work.
- Service calls — there is no `cosmos.callService`. The agent cannot turn lights on/off; describe state, do not mutate it.
- Top-frame navigation, popups, forms, pointer-lock — sandboxed away by the browser.
- `@font-face` loading from cross-origin URLs — embed fonts as data URLs if you must.

## HA entity reference

Inside a canvas you read live HA data two ways:

- **Templates (server-side):** `{{ states("light.lamp") }}`, `{{ state_attr("media_player.spotify", "media_title") }}` — full Jinja, evaluated by HA before the canvas renders.
- **JS (in-iframe):** `cosmos.entity('light.lamp')` returns `{ entity_id, state, attributes }`; `cosmos.subscribe('light.lamp', cb)` re-fires on changes.

The reference below lists the `state` shape and the `attributes` keys Cosmos itself extracts for each domain — these are the keys most likely to be present and useful. HA entities can carry other attributes too; this is the curated set that's reliable across mainstream integrations.

### `weather.*`

| Source | Field | Notes |
|---|---|---|
| `state` | string | The current condition word: `"sunny"`, `"cloudy"`, `"partlycloudy"`, `"rainy"`, `"snowy"`, `"clear-night"`, `"fog"`, `"hail"`, `"lightning"`, `"lightning-rainy"`, `"pouring"`, `"windy"`, `"windy-variant"`. |
| `attributes` | `temperature` (number) | Current temperature. |
| | `temperature_unit` (string) | `"°C"` or `"°F"` (look for the `F`). |
| | `humidity` (number, %) | |
| | `pressure` (number, hPa or inHg per HA's unit settings) | |
| | `wind_speed` (number) | Unit per HA settings. |
| | `wind_bearing` (number degrees, or string like `"NE"`) | |
| | `visibility` (number) | |
| | `cloud_coverage` (number, %) | |
| | `uv_index` (number) | |
| | `apparent_temperature`, `dew_point` (numbers) | When provided. |

Forecasts (`daily`, `hourly`, `twice_daily`) are not on the entity in HA 2024.4+; they're fetched via a service call. If the agent needs forecast data inside a canvas, prefer using a `weather` widget elsewhere on the scene, OR write Jinja that calls `state_attr(...)` for any legacy-style forecast attribute.

### `media_player.*`

| Source | Field | Notes |
|---|---|---|
| `state` | string | One of `"playing"`, `"paused"`, `"idle"`, `"on"`, `"off"`, `"standby"`, `"buffering"`, `"unknown"`. |
| `attributes` | `friendly_name` (string) | |
| | `media_title` (string) | |
| | `media_artist` (string) | |
| | `media_album_name` (string) | |
| | `entity_picture` (string, URL) | Album art. **Relative path** (e.g. `/api/media_player_proxy/...`) — to render this from inside the canvas, prefix it with the absolute HA URL the user knows. Cosmos's own `MediaPlayer` widget absolutizes this via `mediaUrlBase` server-side; in a canvas you don't have that, so you typically render album art only when `entity_picture` already starts with `http`. |
| | `media_position` (number, seconds) | |
| | `media_duration` (number, seconds) | |
| | `volume_level` (number, 0–1) | |
| | `is_volume_muted` (boolean) | |
| | `source` (string) | Currently selected input. |
| | `app_name` (string) | "Spotify", "YouTube", etc. |
| | `supported_features` (number, bitmask) | Bits: `1=PAUSE`, `4=VOLUME_SET`, `16=PREV`, `32=NEXT`, `2048=SELECT_SOURCE`, `16384=PLAY`. AND-mask to test capability. |

### `camera.*`

| Source | Field | Notes |
|---|---|---|
| `state` | string | `"idle"`, `"recording"`, `"streaming"`, `"unavailable"`. |
| `attributes` | `friendly_name` (string) | |
| | `entity_picture` (string, URL) | Signed snapshot URL from HA. |

**Live snapshot/stream URLs:** the iframe origin is `null` so it cannot use `entity_picture` (signed token, expires) reliably. Cosmos exposes a same-origin proxy at `/api/ha-media/api/camera_proxy/{entity_id}` (still-frame) and `/api/ha-media/api/camera_proxy_stream/{entity_id}` (MJPEG stream), but these are reachable from the parent display — **not from the null-origin canvas iframe** (cross-origin to its own server). To put a camera image in a canvas, prefer the dedicated `camera` widget over re-implementing it in a canvas.

### `calendar.*`

| Source | Field | Notes |
|---|---|---|
| `state` | string | `"on"` if an event is currently active, otherwise `"off"`. |
| `attributes` | `message` (string) | Current/next event title. |
| | `start_time`, `end_time` (string, ISO-ish) | Of the current/next event. |
| | `description` (string) | |
| | `location` (string) | |
| | `all_day` (boolean) | |

For multiple upcoming events, use the `calendar` widget — it pulls a windowed list via `calendar.get_events` which the canvas API doesn't expose.

### `light.*`

| Source | Field | Notes |
|---|---|---|
| `state` | string | `"on"` or `"off"`. |
| `attributes` | `brightness` (number, 0–255) | |
| | `color_mode` (string) | `"hs"`, `"xy"`, `"rgb"`, `"rgbw"`, `"color_temp"`, `"brightness"`, `"onoff"`. |
| | `hs_color` (`[hue, saturation]`) / `rgb_color` (`[r,g,b]`) | When color-capable. |
| | `color_temp_kelvin` (number) | For tunable-white lights. |
| | `effect` (string) | Active effect name. |

### `switch.*`, `input_boolean.*`

| Source | Field |
|---|---|
| `state` | `"on"` or `"off"`. |
| `attributes.friendly_name` (string) | |

### `binary_sensor.*`

| Source | Field | Notes |
|---|---|---|
| `state` | string | `"on"` (problem/active) or `"off"` (clear). |
| `attributes` | `device_class` (string) | `"motion"`, `"door"`, `"window"`, `"smoke"`, `"moisture"`, `"occupancy"`, `"battery"`, `"connectivity"`, `"plug"`, `"presence"`, etc. Drives display semantics. |
| | `friendly_name` (string) | |

### `sensor.*`

| Source | Field | Notes |
|---|---|---|
| `state` | string | The numeric or text reading. Always parse with `Number(state)` if you expect numbers — HA can return `"unavailable"` or `"unknown"`. |
| `attributes` | `unit_of_measurement` (string) | `"W"`, `"°C"`, `"%"`, `"hPa"`, etc. |
| | `device_class` (string) | `"temperature"`, `"humidity"`, `"power"`, `"energy"`, `"battery"`, `"illuminance"`, `"pressure"`, `"voltage"`, `"current"`, etc. |
| | `state_class` (string) | `"measurement"` (instantaneous), `"total"` / `"total_increasing"` (cumulative). |
| | `friendly_name` (string) | |
| | `last_changed` (ISO timestamp) | Useful with `relative_time(...)` in Jinja. |

### `climate.*`

| Source | Field | Notes |
|---|---|---|
| `state` | string | HVAC mode: `"off"`, `"heat"`, `"cool"`, `"heat_cool"`, `"auto"`, `"dry"`, `"fan_only"`. |
| `attributes` | `current_temperature` (number) | Room reading. |
| | `temperature` (number) | Setpoint (single). |
| | `target_temp_high`, `target_temp_low` (number) | Setpoints (range). |
| | `current_humidity`, `humidity` (number) | |
| | `hvac_action` (string) | What it's actually doing right now: `"heating"`, `"cooling"`, `"idle"`, `"off"`, `"fan"`, `"drying"`, `"defrosting"`. |
| | `fan_mode`, `swing_mode`, `preset_mode` (string) | |

### `cover.*`

| Source | Field |
|---|---|
| `state` | `"open"`, `"closed"`, `"opening"`, `"closing"`. |
| `attributes.current_position` (number, 0–100) | Percent open. |
| `attributes.current_tilt_position` (number, 0–100) | If applicable. |

### `lock.*`

| Source | Field |
|---|---|
| `state` | `"locked"`, `"unlocked"`, `"locking"`, `"unlocking"`, `"jammed"`, `"unknown"`. |
| `attributes.friendly_name` (string) | |

### `person.*` / `device_tracker.*`

| Source | Field | Notes |
|---|---|---|
| `state` | string | Zone name or `"home"` / `"not_home"`. |
| `attributes` | `latitude`, `longitude` (number) | |
| | `gps_accuracy` (number, meters) | |
| | `source_type` (string) | `"gps"`, `"router"`, `"bluetooth"`, etc. |
| | `entity_picture` (string) | Avatar (`person.*` only, signed URL — see camera notes). |

### `sun.sun`

| Source | Field |
|---|---|
| `state` | `"above_horizon"` or `"below_horizon"`. |
| `attributes.elevation` (number, degrees) | |
| `attributes.azimuth` (number, degrees) | |
| `attributes.next_dawn`, `next_dusk`, `next_midnight`, `next_noon`, `next_rising`, `next_setting` (ISO timestamps) | |

### Time helpers (no entity needed)

These are Jinja-only, valid inside `{{ }}`:

- `now()` — current time as a `datetime`.
- `utcnow()` — UTC variant.
- `as_timestamp(...)` — converts string/datetime to a Unix timestamp.
- `relative_time(states.<entity>.last_changed)` — `"5 minutes ago"`.
- `today_at("18:30")`, `now() + timedelta(hours=1)` — arithmetic.

Inside JS you have the standard `Date` and `Intl.DateTimeFormat` — prefer those for live ticking clocks (don't subscribe to `now()` via templates; that re-renders the whole canvas).

### Reading attributes — the two ways

```html
<!-- Jinja: server-side, baked into the rendered HTML. Re-renders on entity change. -->
<div>{{ state_attr("media_player.spotify", "media_title") }}</div>

<!-- JS: live, no re-render. -->
<div id="title"></div>
<script>
  cosmos.subscribe('media_player.spotify', (e) => {
    document.getElementById('title').textContent = e.attributes.media_title || '—';
  });
</script>
```

Reach for Jinja when the value should be baked-in once. Reach for JS subscribe when the canvas needs to react smoothly without a full re-render (animations, scroll position, etc.).

## Style hints

- Always size your root to `width: 100%; height: 100%`. The canvas fills its grid cell, which is variable.
- Apply `font-family: var(--cosmos-font-family, system-ui), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` to your root so typography matches the surrounding scene. Use `calc(1rem * var(--cosmos-font-scale, 1))` for body copy that should track the scene's scale knob.
- For surfaces that should blend with the scene, reach for `var(--cosmos-bg, transparent)` rather than a hardcoded color.
- Prefer light, airy layouts. Cosmos kiosk surfaces are usually viewed from across a room.
- Pure-CSS animations beat JS animations. Use `requestAnimationFrame` only when CSS can't express the effect.
- Keep total document under 50,000 characters. Larger payloads slow scene pushes.

## Completion shapes

### "Number card" — show one HA value with a label

```html
<div style="padding:1.5rem;font-family:var(--cosmos-font-family,system-ui),system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f5f5f5">
  <div style="opacity:0.6;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em">{LABEL}</div>
  <div style="font-size:calc(3rem * var(--cosmos-font-scale,1));font-weight:200;line-height:1.1">{{ states("{ENTITY}") }} {UNIT}</div>
</div>
```

### "Live gauge" — animated SVG bound to a sensor

```html
<div style="display:grid;place-items:center;width:100%;height:100%">
  <svg viewBox="0 0 100 60" width="80%">
    <path d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="6"/>
    <path id="fill" d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="0 200"/>
    <text id="lbl" x="50" y="50" text-anchor="middle" fill="#fff" font-size="12">—</text>
  </svg>
</div>
<script>
  cosmos.subscribe('{ENTITY}', (e) => {
    const v = Number(e.state) || 0;
    const pct = Math.min(1, v / {MAX});
    document.getElementById('fill').setAttribute('stroke-dasharray', (pct * 126) + ' 200');
    document.getElementById('lbl').textContent = Math.round(v) + ' {UNIT}';
  });
</script>
```

### "Static info card" — fixed content, no templates, no JS

```html
<div style="padding:1rem;font-family:var(--cosmos-font-family,system-ui),system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f5f5f5">
  <h2 style="margin:0;font-weight:300">{TITLE}</h2>
  <p style="margin:0.5rem 0 0;opacity:0.85;line-height:1.5">{BODY}</p>
</div>
```

Replace `{ENTITY}`, `{LABEL}`, `{UNIT}`, `{MAX}`, `{TITLE}`, `{BODY}` with values from the user's intent.
