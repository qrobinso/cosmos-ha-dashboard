# Scene authoring — agent contract

> *This file is for an LLM. If you're a human looking for setup steps, see [getting-started-with-agents.md](./getting-started-with-agents.md).*

This document is intended to be pasted into an LLM agent's system prompt or pulled in alongside [`canvas-widget-agent.md`](./canvas-widget-agent.md). It describes how to compose a Cosmos scene — the surface a wall display renders — and how to publish it through the REST API.

The expected pairing: the agent decides on a scene shape (background + typography + a small set of widgets), authors any canvas content separately using the canvas guide, then `POST`s a scene payload, assigns the scene to a display, and activates it.

## Contract

You produce a JSON Scene payload. The host application sends it to the Cosmos server. The Scene fully describes how the wall display will render — there is no implicit state, no styling outside the payload.

A complete agent flow is three calls:

1. `POST /api/scenes` with the Scene body — creates the scene, returns it with an `id`.
2. `POST /api/displays/{name}/assign-scene` with `{ "sceneId": "<id>" }` — links it to a display.
3. `POST /api/displays/{name}/scene/activate` with `{ "sceneId": "<id>" }` — pushes it live.

Steps 2 and 3 can be combined in spirit by passing `"makeDefault": true` to step 2, but `activate` is what causes the wall display to transition to the new scene immediately.

For **updating** an existing scene rather than creating one, jump to [Updating an existing scene](#updating-an-existing-scene) — it's a different (and usually shorter) loop.

## Scene payload schema

```ts
type SceneInput = {
  name: string;                          // human label, e.g. "Morning kitchen"
  layout: {
    cols: number;                        // grid columns. Use 12.
    rows: number;                        // grid rows. Use 8.
    items: never[];                      // leave as []
                                         //  the server derives layout from widgets[]
  };
  background: Background;
  typography: { font_family: string; font_scale: number };
  widgets: Array<{
    kind: WidgetKind;
    position: { col: number; row: number; w: number; h: number };
    config: Record<string, unknown>;     // widget-specific
  }>;
  defaultTransitionId?: string | null;   // see "Transitions"
  floatWidgets?: boolean;                // default false
  mood?: MoodConfig;                     // optional looping video atmosphere
};

type Background =
  | { type: 'solid'; color: string }     // any CSS color string ("#0a0f1c", "rgb(...)")
  | { type: 'gradient';
      colors: string[];                  // 2–4 CSS colors (used as fallback when overrides apply)
      speed: 'slow' | 'medium' | 'fast';
      style: 'mesh' | 'linear' | 'radial';
      sun_adaptive?: boolean;            // when true, server overrides colors by time of day
      adaptive_colors?: boolean;         // when true, pull live colors from widgets (album art, canvas reports)
    };

type WidgetKind =
  | 'clock' | 'weather' | 'entity_tile' | 'calendar'
  | 'media_player' | 'statistics' | 'text' | 'camera' | 'canvas';
```

### Coordinates

`position` uses 1-indexed grid coordinates. With a `12 × 8` grid:

- `{ col: 1, row: 1, w: 12, h: 8 }` — fills the whole scene.
- `{ col: 4, row: 3, w: 6, h: 4 }` — centered medium card.
- `{ col: 1, row: 1, w: 12, h: 1 }` — a top strip.

Widgets must not overlap, and every cell of a widget's rectangle must fit inside `cols × rows`.

### Typography

`font_family` accepts these bundled families (ship without download cost):

- `"Inter"` — neutral sans (default)
- `"Fraunces"` — display serif, expressive headlines
- `"Space Grotesk"` — geometric sans, modern UI feel
- `"JetBrains Mono"` — monospace, data / numerals

Anything else is allowed as a string but the wall display falls back to system fonts. `font_scale` is a multiplier; `1.0` is the canonical size, `1.25–1.5` for far-room readability, `0.85` for a packed dashboard.

### Transitions

Pass `defaultTransitionId` as one of:

- `"builtin-cross-fade"` (gentle default)
- `"builtin-scale-fade"` (fade with subtle zoom)
- `"builtin-slide-up"` / `"builtin-slide-down"` (directional)
- `"builtin-dissolve"` (textured)
- `"builtin-gradient-morph"` (best when both scenes are gradient)

Omit or pass `null` to inherit the global default.

## Best practices

These apply the wall-display principles — see `wall-display-principles.md` for the full set and the *why*; below is how they shape a *scene*.

### Focus

*(Principle 5: information density — less is more. Principle 2: one hero per widget, applied at scene scale: one hero widget per scene.)*

- **Pick one primary thing per scene.** A morning scene shows the time and the weather, not eight tiles. A workout scene shows heart rate; nothing else competes.
- **Two or three widgets is plenty.** Four is the upper bound. A scene with seven widgets has failed before it rendered.
- **One canvas can be the entire scene.** When the user's intent is a custom dashboard, the right answer is almost always: a single canvas widget at `{ col: 1, row: 1, w: 12, h: 8 }` containing the layout, with HA templates inside it.

### Centering and breathing room

*(Principle 9: consistent grid and rhythm.)*

- Center the primary widget. Either:
  - Make it span the full grid (`w: 12, h: 8`) and let its CSS handle alignment, or
  - Place it in the centered region (e.g., `{ col: 3, row: 2, w: 8, h: 5 }`) so the safe-area padding does the framing.
- Avoid hugging the corners. The display has global safe-area padding, but visual weight near the edges still feels cramped.
- When you do use multiple widgets, keep them on a shared baseline — same row, same height — rather than scattering them at irregular grid offsets.

### Background

*(Principle 4: high contrast, limited palette — dark grounds usually win. Principle 10: context-aware brightness — `sun_adaptive` is how a scene adapts over the day. Principle 6: the gradient + mood layers are deliberate ambient drift, not a motion violation.)*

- **Solid first.** A flat, dark-ish color (`#0a0f1c`, `#0e0e0e`, `#101820`) reads cleaner than any gradient, and lets widget content carry the visual interest.
- **Gradient when the scene IS the visual.** Reach for a gradient when there's no foreground content to look at — an ambient "now playing" or weather-only scene.
- **`sun_adaptive: true`** is a powerful default for a single "ambient" scene the user runs all day. The server picks colors by time of day; you don't have to.
- **`adaptive_colors: true`** when the scene has a widget that supplies colors — the gradient then tracks what's on screen. Reach for it when:
  - The scene has a `media_player` widget (album art drives the gradient — works anytime music is playing).
  - The scene has a `canvas` widget that calls `cosmos.reportColors([...])` to feed the gradient (see canvas-widget-agent.md).
  - You want the wall to feel "alive" with whatever the user is doing — a now-playing scene, a generative-canvas mood scene, a hero-image dashboard.

  Don't bother enabling it on scenes that have no color-emitting widgets (clock-only, weather-only, plain entity tiles) — nothing reports, the gradient stays on `colors`. Composes with `sun_adaptive`: sun sets the resting palette, adaptive overrides whenever a widget is reporting. The `colors` you provide are still used as the fallback when nothing's reporting *and* to pad the palette to 3 stops if a widget reports fewer.

### Typography

*(Principle 3: distance-appropriate typography.)*

- Inter, scale 1.0, for general dashboards.
- Fraunces, scale 1.1–1.25, for display-heavy scenes (morning/news).
- JetBrains Mono, scale 0.95, for numeric / data dashboards.
- Don't use Space Grotesk for body copy — it's a display face. Reserve it for one-word scene names.

### Canvas pairing rule

When a canvas is involved, prefer **one canvas filling the whole scene** over a canvas plus other widgets. The canvas should set its own typography via `var(--cosmos-font-family)` so it inherits the scene's choice (see `canvas-widget-agent.md`). This keeps the visual layer in one place where you can iterate and the rest of the scene is just background + safe area.

### Don'ts

*(Principle 5 again, stated as anti-patterns.)*

- **Don't add widgets for symmetry.** "There's empty space, I'll add a clock" is the wrong instinct. Empty space is what makes the focused widget breathe.
- **Don't pick gaudy gradients.** Two muted stops beat four vibrant ones every time.
- **Don't use `font_scale` below 0.8.** Anything that small isn't readable from a wall.
- **Don't activate a scene the user didn't ask for.** Step 3 (`/activate`) interrupts what's currently on the display. If unsure, do step 1 + 2 (`makeDefault: false`) and let the user activate from the editor.

## Canonical scene shapes

### Single full-bleed canvas (most common when paired with canvas-widget-agent)

```json
{
  "name": "Energy dashboard",
  "layout": { "cols": 12, "rows": 8, "items": [] },
  "background": { "type": "solid", "color": "#0a0f1c" },
  "typography": { "font_family": "Inter", "font_scale": 1.0 },
  "defaultTransitionId": "builtin-cross-fade",
  "widgets": [
    {
      "kind": "canvas",
      "position": { "col": 1, "row": 1, "w": 12, "h": 8 },
      "config": { "content": "<!-- HTML/CSS/JS produced by canvas-widget-agent -->" }
    }
  ]
}
```

This is the default for any "build me a dashboard that shows X" request. The canvas does all the layout; the scene just sets the background, typography, and transition.

### Hero clock + weather strip

```json
{
  "name": "Morning",
  "layout": { "cols": 12, "rows": 8, "items": [] },
  "background": {
    "type": "gradient",
    "colors": ["#1a1a2e", "#2d2d4a"],
    "speed": "slow",
    "style": "mesh",
    "sun_adaptive": true
  },
  "typography": { "font_family": "Fraunces", "font_scale": 1.2 },
  "defaultTransitionId": "builtin-scale-fade",
  "widgets": [
    {
      "kind": "clock",
      "position": { "col": 3, "row": 2, "w": 8, "h": 4 },
      "config": { "format": "h:mm", "show_seconds": false, "show_date": true }
    },
    {
      "kind": "weather",
      "position": { "col": 1, "row": 7, "w": 12, "h": 2 },
      "config": { "entity_id": "weather.home", "forecast_type": "daily" }
    }
  ]
}
```

Centered hero clock with a thin daily forecast strip across the bottom. Two widgets, plenty of breathing room.

### Ambient (gradient only, no widgets)

```json
{
  "name": "Ambient",
  "layout": { "cols": 12, "rows": 8, "items": [] },
  "background": {
    "type": "gradient",
    "colors": ["#0a0a2e", "#1a1f4a", "#0e2e3e"],
    "speed": "slow",
    "style": "mesh",
    "sun_adaptive": true
  },
  "typography": { "font_family": "Inter", "font_scale": 1.0 },
  "defaultTransitionId": "builtin-gradient-morph",
  "widgets": []
}
```

Zero widgets is valid and useful. Use this for a scene the user wants running on the wall as atmosphere — overnight, during a meeting, while music plays.

### Single entity, hero size

```json
{
  "name": "Living room temp",
  "layout": { "cols": 12, "rows": 8, "items": [] },
  "background": { "type": "solid", "color": "#0a0f1c" },
  "typography": { "font_family": "Fraunces", "font_scale": 1.4 },
  "defaultTransitionId": "builtin-cross-fade",
  "widgets": [
    {
      "kind": "entity_tile",
      "position": { "col": 1, "row": 1, "w": 12, "h": 8 },
      "config": { "entity_id": "sensor.living_room_temperature" }
    }
  ]
}
```

One thing, huge. The display becomes a giant readout. Best for a tablet that's only ever showing this scene.

## Updating an existing scene

When the user asks you to *change* something on an existing scene (rather than create a new one), use the focused per-widget endpoints. Round-tripping the entire scene is wasteful and can churn unrelated widget state.

### Discovery

```bash
# All scenes
GET /api/scenes
# → [{ id, name, background, typography, widgets: [...], ... }, ...]

# All widgets across all scenes (flatter, easier to filter)
GET /api/widgets

# Filter widgets by scene name + kind — usually what you want
GET /api/widgets?scene=Kitchen&kind=canvas
# → [{ id, sceneId, sceneName, kind, position, config }, ...]
```

Widget `id`s are stable across saves. Once you have one you can hold onto it for repeated patches.

### Discovering HA entities (for canvas templates and entity-bearing widgets)

A real HA install can have thousands of entities. **Don't slurp the full list** into context — narrow before reading.

```bash
# Orient first if you have no idea what's there. Tiny payload.
GET /api/ha/entities/summary
# → { total: 412, domains: { sensor: 198, light: 38, ... },
#                deviceClasses: { temperature: 14, motion: 8, ... } }

# Narrow with any combination of domain / device_class / search / limit.
# `search` is case-insensitive substring against entity_id + friendly_name.
GET /api/ha/entities?domain=sensor&search=kitchen
GET /api/ha/entities?device_class=temperature
GET /api/ha/entities?domain=light&limit=20
```

Over MCP the same pattern is `summarize_ha_entities` (the orientation snapshot) and `list_ha_entities` (with `domain`, `device_class`, `search`, `limit` args). The server echoes `{count, totalMatches, truncated}` so you can tell when more rows existed than were returned.

Use the entity ids you discover here in your widget configs (`entity_tile.config.entity_id`, `weather.config.entity_id`, etc.) and in canvas widget Jinja templates (`{{ states('sensor.kitchen_temp') }}`). Validating entity_ids client-side: any entity-bearing widget kind requires `config.entity_id` to be a syntactically-valid `domain.object_id` — empty strings and freeform text are rejected with a 400.

### Update one widget — the most common agent task

For a canvas's HTML body, the smallest possible request:

```bash
PUT /api/widgets/<widget-id>/content
Content-Type: text/html

<div style="...">{{ states("sensor.power") }} W</div>
```

Or as JSON: `{ "content": "<div>...</div>" }`. This shortcut is canvas-only.

For any other config field (or any other widget kind), use the partial PATCH:

```bash
PATCH /api/widgets/<widget-id>
Content-Type: application/json

{ "config": { "format": "h:mm", "show_seconds": true } }
```

`config` is shallow-merged — keys you don't include are left alone. `position` can also be patched (e.g. to resize: `{ "position": { "col": 1, "row": 1, "w": 12, "h": 8 } }`).

Both endpoints push the updated scene to every display showing it; the wall display refreshes within a second.

### Update scene-level fields (background, typography, mood, transition)

For changes that affect the whole scene rather than one widget — a different background, font family, mood video, default transition — use the partial **PATCH**:

```bash
PATCH /api/scenes/<scene-id>
Content-Type: application/json

{ "background": { "type": "solid", "color": "#0a0f1c" } }
```

`PATCH` accepts any subset of the scene's top-level keys (`name`, `layout`, `background`, `typography`, `defaultTransitionId`, `floatWidgets`, `mood`). **Widgets are never touched** — they're preserved verbatim across the patch. Use this for "change the mood", "rename the scene", "swap the gradient", etc. Much safer than the full `PUT` (see warning below).

> **Warning — `PUT /api/scenes/<id>` replaces every widget.** The full SceneInput PUT was the original update path; it is **destructive on widget config**. Each widget object you include is stored exactly as you sent it. If a widget's `config` is `{}` in your payload, that widget's previous config (e.g. canvas HTML) is **wiped**. There's no merge, no preserve-on-omit. Only use `PUT` for a wholesale rewrite — and even then, fetch first via `GET /api/scenes/<id>` and pass widgets through unchanged. For everything else use `PATCH /api/scenes/<id>` (above) or per-widget `PATCH /api/widgets/<id>` / `PUT /api/widgets/<id>/content`.

### Mood: enabling and disabling

The `mood` field is `{ enabled: boolean, strategy?, moodId?, weatherEntity?, opacity? }`. When `enabled: false`, the other fields are **not required** — `{enabled: false}` alone is a valid disabled-mood. When `enabled: true`, you must provide a strategy:

- `{ enabled: true, strategy: "manual", moodId: "<id-from-/api/moods>" }`
- `{ enabled: true, strategy: "time" }` — server picks by time of day
- `{ enabled: true, strategy: "weather", weatherEntity: "weather.<id>" }`

`opacity` (0–1) is optional in any mode.

### Widget shape requirements

Every widget in `widgets[]` must have `kind` (string), `position` (object), and `config` (object — at minimum `{}`). A missing `config` returns a `400` with a clear message. Don't omit the field; pass `{}` when there's no per-widget configuration.

### Background shape requirements

`background` must be an object — never a JSON-stringified version of one. The PATCH/PUT validators check shape:

- `{type:"solid", color:"<css-color>"}` — `color` is required and must be a non-empty string.
- `{type:"gradient", colors:[<css-colors>], speed:"slow|medium|fast", style:"mesh|linear|radial", sun_adaptive?: boolean, adaptive_colors?: boolean}` — `colors` must be an array of strings. `adaptive_colors` opts into pulling live colors from widgets (album art, canvas `cosmos.reportColors`); `colors` then becomes the fallback / padding palette.

A string-typed background (e.g. `"{\"type\":\"solid\",\"color\":\"#fff\"}"`) returns a `400 background must be an object` rather than persisting silently.

### Show a scene briefly, then revert (alerts)

If the user asks "flash the doorbell scene for 15 seconds when someone rings," that's a **scene alert**, not a permanent activation:

```bash
POST /api/displays/<name>/scene/alert
Content-Type: application/json

{ "sceneId": "scene-doorbell-abc", "dwellMs": 15000 }
# Optional: "transitionId": "builtin-cross-fade"
```

The display flips to the named scene, holds for `dwellMs`, then auto-reverts to whatever was on screen before. The timer lives server-side, so it survives reconnects. Manual scene changes mid-dwell cancel the auto-revert. Chained alerts preserve the original revert target so a display can't get trapped.

This is the right tool for transient notifications (doorbell, oven timer, motion alert) — much cleaner than `/scene/activate` followed by a delayed second `/scene/activate`.

### Typical agent loops

**"Update the Kitchen canvas to show today's energy use":**

1. `GET /api/widgets?scene=Kitchen&kind=canvas` → pick the target widget's `id`
2. `PUT /api/widgets/<id>/content` with the new HTML

**"Change the morning scene to Fraunces font":**

1. `GET /api/scenes` → find the scene's `id`
2. `PATCH /api/scenes/<id>` with `{ "typography": { "font_family": "Fraunces", "font_scale": 1.0 } }`

(No need to fetch the whole scene — PATCH preserves everything you don't include.)

**"Turn off the mood video on the Living Room scene":**

1. `GET /api/scenes` → find the scene's `id`
2. `PATCH /api/scenes/<id>` with `{ "mood": { "enabled": false } }`

**"Show the doorbell scene for 15s when X happens":**

1. `POST /api/displays/<name>/scene/alert` with `{sceneId, dwellMs:15000}`

## End-to-end example (cURL)

```bash
# 1. Create
curl -sX POST http://localhost:8099/api/scenes \
  -H 'content-type: application/json' \
  -d '{ "name": "...", "layout": {"cols":12,"rows":8,"items":[]}, ... }'
# → returns { "id": "scene-abc123", ... }

# 2. Assign to a display (use the display's name, not its id)
curl -sX POST http://localhost:8099/api/displays/Kitchen/assign-scene \
  -H 'content-type: application/json' \
  -d '{ "sceneId": "scene-abc123", "makeDefault": true }'

# 3. Activate (push live)
curl -sX POST http://localhost:8099/api/displays/Kitchen/scene/activate \
  -H 'content-type: application/json' \
  -d '{ "sceneId": "scene-abc123" }'
```

Activate triggers the configured transition; the wall display animates from whatever was on screen to the new scene in roughly one second.

## Widget config quick reference

For a paired-with-canvas flow, you mostly need `canvas`. Other widgets if you decide they fit:

- `clock` — `{ format: 'HH:mm' | 'h:mm', show_seconds?: bool, show_date?: bool }`
- `weather` — `{ entity_id: 'weather.*', forecast_type: 'daily' | 'hourly' | 'twice_daily' }`
- `entity_tile` — `{ entity_id: 'domain.id' }` — auto-picks a renderer based on domain
- `calendar` — `{ entity_id: 'calendar.*', max_events?: number }`
- `media_player` — `{ entity_id: 'media_player.*' }`
- `statistics` — `{ entity_id: 'sensor.*', range_hours?: number }`
- `text` — `{ text: string, align?: 'left'|'center'|'right' }`
- `camera` — `{ entity_id: 'camera.*' }`
- `canvas` — `{ content: string }` — see [canvas-widget-agent.md](./canvas-widget-agent.md)

If the user's intent doesn't clearly map to a non-canvas widget, prefer a single full-bleed canvas — it's strictly more capable and the canvas guide tells you exactly how to author it.
