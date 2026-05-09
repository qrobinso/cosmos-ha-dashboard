# How the canvas widget works

A canvas widget renders any HTML/CSS/JS you (or an LLM agent) write inside a sandboxed iframe filling the widget's grid cell.

## Templates

Wrap any expression in `{{ ... }}` to have Home Assistant render it server-side using its **standard template engine**. Anything that works in an HA automation works here:

```html
<h1>{{ states("sensor.power") }} W</h1>
<p>last seen {{ relative_time(states.binary_sensor.front_door.last_changed) }}</p>
```

## The `cosmos` API

Inside the iframe, `window.cosmos` exposes:

| Member | Purpose |
|---|---|
| `cosmos.ready` | A promise that resolves when the bridge has handshook with the parent. |
| `cosmos.size = { w, h }` | The cell's pixel dimensions. Updates on resize; listen with `window.addEventListener('cosmos:resize', ...)`. |
| `cosmos.scene = { id, name }` | Scene metadata. |
| `cosmos.font = { family, scale }` | The scene's chosen typography. |
| `cosmos.entity('sensor.foo')` | Returns the cached `EntityState` or `null`. |
| `cosmos.subscribe('sensor.foo', cb)` | Calls `cb(entity)` on every state change. Returns an `unsubscribe()`. |

The API is **read-only**. Service calls are not yet supported.

## Scene tokens (CSS vars)

Cosmos sets these on `:root` and updates them live with the scene:

| Variable | Use |
|---|---|
| `--cosmos-font-family` | `font-family: var(--cosmos-font-family, system-ui)` |
| `--cosmos-font-scale` | `font-size: calc(1rem * var(--cosmos-font-scale, 1))` |
| `--cosmos-bg` | `background: var(--cosmos-bg, transparent)` |
| `--cosmos-fg` | `color: var(--cosmos-fg, #f5f5f5)` — tracks the scene's text color override + background auto-contrast |
| `--cosmos-w` / `--cosmos-h` | iframe pixel size for `clamp()` math |

Reach for these instead of reading `cosmos.font.*` from JS — your styles track the scene automatically.

## Sandbox

The iframe runs with `sandbox="allow-scripts"`. That means:

- No same-origin access (no parent storage, no top-frame navigation).
- No forms, popups, or pointer-lock.
- Cross-origin font loading via `@font-face` will fail. Use system fonts (the parent passes a usable family in `cosmos.font.family`) or embed your font as a data URL.

## One canvas per scene

Tablets running 24/7 with multiple sandboxed iframes pay a real memory + decode cost. The editor lets you place more than one, but the recommendation is **one canvas per scene**.
