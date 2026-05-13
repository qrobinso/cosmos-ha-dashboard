# Wall display design principles — agent contract

> *This file is for an LLM. If you're a human looking for setup steps, see [getting-started-with-agents.md](./getting-started-with-agents.md).*

This is the first-principles layer. The scene contract (`scene-agent.md`) and the canvas contract (`canvas-widget-agent.md`) tell you *how* to build; this doc tells you *what good looks like*. A Cosmos display is a screen on a wall, read from across a room (6–15 ft) by people doing other things. It is not a web page. Every scene and every canvas you produce gets judged against the 11 principles below — apply them ruthlessly.

## 1. The 3-second rule

Primary info must land in under 3 seconds from across the room. If a viewer would have to walk closer or focus to read it, the widget failed. Every widget has exactly one dominant datum readable at distance; everything else is supporting context for when they *do* lean in.

## 2. One hero per widget

Exactly one "hero" element, sized 3–5× larger than the supporting info. Temperature widget: the number is huge, "feels like" is small. Calendar: the next event title is the hero, time/location are secondary. Nothing competes with the hero. On Cosmos this is the canvas contract's "Hero numerals" recipe; for lists where the most-relevant item should pop without reflow, use its "Adaptive priority — show all, promote one" pattern.

## 3. Distance-appropriate typography

Hero text wants to render at an effective 48–72pt+ (rough rule: ~1 inch of glyph height per 10 ft of viewing distance). Use heavy weights for hero numbers — thin weights vanish at distance, which is why the canvas contract says `font-weight: 500`, never 200/300. High x-height faces (Inter et al.) beat decorative ones for data. Avoid italic, light weights, and all-caps *body* text; tracked-uppercase *kicker labels* are fine — that's the established recipe. On Cosmos: wrap every `font-size` in `calc(... * var(--cosmos-font-scale, 1))` so the scene scale knob moves everything together; give the hero the scene face and use Inter for instrument-panel text (labels, units, suffixes). See the canvas contract's "Typography rule of thumb — scene font is the *voice*, Inter is the *instrument panel*."

## 4. High contrast, limited palette

Aim WCAG AAA (7:1+) for primary content. Per widget: 1 background, 1–2 text colors, 1–2 accents. Color encodes meaning (red = urgent, green = good) — it doesn't decorate. Dark grounds usually win on a wall: dim rooms, hours-long uptime. On Cosmos you don't compute body-text contrast by hand — use `var(--cosmos-fg, #f5f5f5)`; it already tracks the scene's `typography.color` override and the background's auto-contrast pick. The carve-out is the hero accent and semantic status colors — those are hardcoded hex, and you must eyeball legibility against the *actual* background you're shipping on. See the canvas contract's "Color rule of thumb" table.

## 5. Information density: less is more

If you can't say what a widget shows in one sentence, it's doing too much. Current state prominent; history, settings, edge cases hidden. The phone is for deep dives — the wall is for "what's happening right now." On Cosmos: ≤4 widgets per scene, 3 is better, and one full-bleed canvas is often best. See `scene-agent.md` → Focus.

## 6. Ambient, not demanding

No attention-grabbing motion *inside widget content* — no looping animations, blinking, spinners, content carousels. Reserve motion and color change for genuine state changes (new message, alarm, anomaly). A static-by-default widget that animates only on real change beats a constantly-moving one. **Cosmos nuance:** the scene's animated *gradient background* and the *Mood Engine video layer* are deliberate, slow, ambient drift — that's the product's calm-by-default aesthetic, not a violation. The rule constrains *widget* content, not the scene's atmosphere layers.

## 7. Graceful degradation

Design failure states explicitly: stale data, network loss, missing values, empty states. "—" with a quiet "updated 2 hr ago" beats yesterday's temperature shown as current. Never let a widget look broken or blank without explanation. On Cosmos: wrap every entity read in defensive defaults (`{{ states("sensor.x") | default("—") }}`, or the `not in ["unknown","unavailable","none"]` guard) — see the system prompt's entity-ID discipline. For `cosmos.fetch` data, keep the last good response on screen if a refresh fails and show a subtle staleness hint — never a spinner.

## 8. Glanceability over interactivity

Wall displays are read, not touched. The default view must be complete on its own. On Cosmos this is *enforced*: canvases are sandboxed and cannot call HA services or mutate state — describe state, never offer controls. Treat any incidental tap (the fullscreen affordance, tap-to-dismiss overlay) as a bonus layer, never the path to a widget's main value.

## 9. Consistent grid and rhythm

A base spacing scale (8pt-style) and a small set of sizes; consistent padding, corner radii, and spacing so the eye finds familiar info fast. On Cosmos: scenes use the 12×8 grid — keep widgets on shared baselines (same row, same height), see `scene-agent.md` → "Centering and breathing room". Canvases should use the active design pack's `spacing` tokens (8/16/32/64/128 — already an 8pt scale) and the pinned card/pill radii from the canvas contract's "Cards & pills" recipe (8 cards / 14 list rows / 999px pills).

## 10. Context-aware brightness and time

The same widget at 3 PM and 3 AM shouldn't look identical — dimmer at night, time-relevant info up front, stale data de-emphasized. Lean on the platform: set `sun_adaptive: true` on a gradient for an all-day ambient scene (the server repalettes by time of day); use a `mood` with `strategy: "time"` for a time-driven video layer; inside a canvas, key visuals off `{{ states("sun.sun") }}` (`above_horizon` / `below_horizon`) or a JS clock check rather than expecting an ambient-light signal (there is none in the iframe). See `scene-agent.md` → Background.

## 11. Time-to-useful, not time-to-rendered

Optimize for when the viewer *has the answer*, not when the widget finished loading. Show cached / last-known values immediately with a subtle refresh hint — never spinners or skeletons as the steady state. On Cosmos: `cosmos.subscribe(id, cb)` already replays the current entity state on attach, so one subscribe call paints immediately and updates live — don't gate the first paint on anything. For `cosmos.fetch`, render last-known on mount and refresh in the background. A 5-minute-old number beats a spinner.

## Before you ship — self-check

Run this before `POST /api/scenes` or `PUT /api/widgets/<id>/content`:

- One hero per widget, identifiable in <3s from across a room?
- ≤4 widgets on the scene, one clear focal point? *(scene: is the hero centered — full-bleed or in the centered region — with breathing room, not hugging corners?)*
- Hero type heavy and large, every `font-size` calc'd against `--cosmos-font-scale`? *(canvas: hero uses the scene face / Inter for numerals; labels and units are Inter even on a serif scene?)*
- Body text on `var(--cosmos-fg)`; the hero accent and any status colors legible on the *actual* background you're shipping?
- Every entity read defended with a `| default("—")` or unknown/unavailable guard?
- No leaked `{{ }}` — every templated `entity_id` is one you actually saw in a `list_ha_entities` result this conversation?
- No attention-grabbing motion in widget content (the gradient + mood layer don't count)?
- Failure / empty / stale states designed, not left blank?
- *(scene: does it adapt over the day — `sun_adaptive`, a time mood, or sun-keyed visuals — if it runs all day?)*
- *(canvas: does it paint immediately from `cosmos.subscribe` / last-known `cosmos.fetch` rather than showing a spinner?)*

If a design pack's prose seems to invite more density or motion than these allow, the principles win.
