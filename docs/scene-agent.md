# Scene authoring — agent contract

This document is intended to be pasted into an LLM agent's system prompt or pulled in alongside [`canvas-widget-agent.md`](./canvas-widget-agent.md). It describes how to compose a Cosmos scene — the surface a wall display renders — and how to publish it through the REST API.

The expected pairing: the agent decides on a scene shape (background + typography + a small set of widgets), authors any canvas content separately using the canvas guide, then `POST`s a scene payload, assigns the scene to a display, and activates it.

## Contract

You produce a JSON Scene payload. The host application sends it to the Cosmos server. The Scene fully describes how the wall display will render — there is no implicit state, no styling outside the payload.

A complete agent flow is three calls:

1. `POST /api/scenes` with the Scene body — creates the scene, returns it with an `id`.
2. `POST /api/displays/{name}/assign-scene` with `{ "sceneId": "<id>" }` — links it to a display.
3. `POST /api/displays/{name}/scene/activate` with `{ "sceneId": "<id>" }` — pushes it live.

Steps 2 and 3 can be combined in spirit by passing `"makeDefault": true` to step 2, but `activate` is what causes the wall display to transition to the new scene immediately.

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
      colors: string[];                  // 2–4 CSS colors
      speed: 'slow' | 'medium' | 'fast';
      style: 'mesh' | 'linear' | 'radial';
      sun_adaptive?: boolean;            // when true, server overrides colors by time of day
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

The Cosmos display is a wall surface viewed from across a room. Its design language is calm, glanceable, and quiet. Apply ruthlessly:

### Focus

- **Pick one primary thing per scene.** A morning scene shows the time and the weather, not eight tiles. A workout scene shows heart rate; nothing else competes.
- **Two or three widgets is plenty.** Four is the upper bound. A scene with seven widgets has failed before it rendered.
- **One canvas can be the entire scene.** When the user's intent is a custom dashboard, the right answer is almost always: a single canvas widget at `{ col: 1, row: 1, w: 12, h: 8 }` containing the layout, with HA templates inside it.

### Centering and breathing room

- Center the primary widget. Either:
  - Make it span the full grid (`w: 12, h: 8`) and let its CSS handle alignment, or
  - Place it in the centered region (e.g., `{ col: 3, row: 2, w: 8, h: 5 }`) so the safe-area padding does the framing.
- Avoid hugging the corners. The display has global safe-area padding, but visual weight near the edges still feels cramped.
- When you do use multiple widgets, keep them on a shared baseline — same row, same height — rather than scattering them at irregular grid offsets.

### Background

- **Solid first.** A flat, dark-ish color (`#0a0f1c`, `#0e0e0e`, `#101820`) reads cleaner than any gradient, and lets widget content carry the visual interest.
- **Gradient when the scene IS the visual.** Reach for a gradient when there's no foreground content to look at — an ambient "now playing" or weather-only scene.
- **`sun_adaptive: true`** is a powerful default for a single "ambient" scene the user runs all day. The server picks colors by time of day; you don't have to.

### Typography

- Inter, scale 1.0, for general dashboards.
- Fraunces, scale 1.1–1.25, for display-heavy scenes (morning/news).
- JetBrains Mono, scale 0.95, for numeric / data dashboards.
- Don't use Space Grotesk for body copy — it's a display face. Reserve it for one-word scene names.

### Canvas pairing rule

When a canvas is involved, prefer **one canvas filling the whole scene** over a canvas plus other widgets. The canvas should set its own typography via `var(--cosmos-font-family)` so it inherits the scene's choice (see `canvas-widget-agent.md`). This keeps the visual layer in one place where you can iterate and the rest of the scene is just background + safe area.

### Don'ts

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
