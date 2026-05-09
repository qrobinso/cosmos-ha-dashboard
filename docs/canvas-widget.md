# Cosmos canvas widget

> *Want an LLM agent (Claude Code, OpenCode, Cursor, …) to author this for you? See [getting-started-with-agents.md](./getting-started-with-agents.md).*

The canvas widget is a sandboxed iframe living inside a single grid cell of your scene. Inside it, you (or an LLM agent) can write any HTML / CSS / JavaScript and bind it to live Home Assistant data using HA's own template engine.

It's the most powerful widget in Cosmos and the only one with a real attack surface; this guide is comprehensive on both ends.

## Quick start

1. Open the scene editor, click **+ Add widget**, switch the kind to **Canvas (HTML/JS)**.
2. Paste this into the content textarea:

```html
<div style="display:grid;place-items:center;width:100%;height:100%;font-family:system-ui;color:#f5f5f5">
  <div>
    <div style="opacity:0.6;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em">Power</div>
    <div style="font-size:3rem;font-weight:200">{{ states("sensor.power") }} W</div>
  </div>
</div>
```

3. Save. The widget renders the value live; when `sensor.power` changes, the displayed number updates within ~100ms.

## Templates: pin-for-pin compatible with HA

Anything inside `{{ ... }}` is rendered by Home Assistant's own Jinja engine. That means:

- Every function and filter that works in an HA automation template works here.
- Cosmos auto-subscribes to the entities your template depends on; no manual wiring needed.
- Errors come back from HA verbatim and render in place of the template (e.g. `TemplateSyntaxError: unexpected '%'`).

Common patterns:

```jinja
{{ states("sensor.kitchen_temp") }}                      → "21.5"
{{ state_attr("weather.home", "humidity") }}             → 64
{{ is_state("binary_sensor.front_door", "on") }}         → True / False
{{ relative_time(states.sensor.power.last_changed) }}    → "5 minutes ago"
{% if is_state("sun.sun", "above_horizon") %}Day{% else %}Night{% endif %}
```

Full template grammar reference: <https://www.home-assistant.io/docs/configuration/templating/>.

## The `cosmos` JS API

Inside the iframe, `window.cosmos` exposes a small read-only API.

| Member | Type | Description |
|---|---|---|
| `cosmos.ready` | `Promise<void>` | Resolves once the bridge has received the parent's initial state push. |
| `cosmos.size` | `{ w: number; h: number }` | Pixel dimensions of the iframe. Updates on resize; subscribe via `window.addEventListener('cosmos:resize', ...)`. |
| `cosmos.scene` | `{ id: string; name: string }` | Scene metadata. |
| `cosmos.font` | `{ family: string; scale: number }` | Inherited typography. The iframe is cross-origin and can't load Cosmos's bundled fonts via `@font-face`, but `family` will name a system-available fallback. |
| `cosmos.version` | `string` | Bridge protocol version. |
| `cosmos.entity(id)` | `(id: string) => EntityState \| null` | One-shot read of a cached entity. Returns null if the entity isn't being tracked yet. |
| `cosmos.subscribe(id, cb)` | `(id: string, cb: (e: EntityState) => void) => () => void` | Calls `cb(entity)` on every state change. The first call also seeds `cb` with the current value if known. Returns an unsubscribe. Subscribing to an entity not already in your templates triggers a server-side subscription request automatically. |
| `cosmos.fetch(url, init?)` | `(url, init?) => Promise<CosmosResponse>` | Outbound HTTP(S) on the iframe's behalf, gated by an admin-managed allowlist. Default policy is deny. See **Outbound fetches** below. |
| `cosmos.reportColors(colors)` | `(colors: string[]) => void` | Contribute up to 5 dominant `#rrggbb` colors to the scene's adaptive gradient. Pass `[]` to clear. Visual effect requires the scene's gradient to have **Adapt to widget colors** enabled; the colors are always recorded server-side regardless. |

The API is intentionally read-only in v1 (no HA service calls). Outbound HTTP via `cosmos.fetch` is the one network primitive available, and only against hosts the user has explicitly allowed.

## Scene tokens (CSS variables)

Beyond the JS API, Cosmos sets a handful of CSS custom properties on `:root` inside the iframe and updates them live as the scene's settings change. Reaching for these via `var(...)` is almost always nicer than reading `cosmos.font.*` from JS — your styling tracks the scene with no extra wiring.

| Variable | Source | Use it for |
|---|---|---|
| `--cosmos-font-family` | scene's typography | `font-family: var(--cosmos-font-family, system-ui), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| `--cosmos-font-scale` | scene's font scale knob | `font-size: calc(1rem * var(--cosmos-font-scale, 1))` |
| `--cosmos-bg` | solid background color, or first stop of a gradient | `background: var(--cosmos-bg, transparent)` for surfaces that should blend |
| `--cosmos-w` / `--cosmos-h` | iframe pixel size | `clamp()` / `min()` math without a `cosmos:resize` listener |
| `--cosmos-scene-id` / `--cosmos-scene-name` | scene metadata | `[data-scene]` selectors, or `content: var(...)` in pseudo-elements |

Recommended baseline for any canvas:

```html
<div style="width:100%;height:100%;font-family:var(--cosmos-font-family,system-ui),system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:calc(1rem * var(--cosmos-font-scale,1));color:#f5f5f5">
  …your content…
</div>
```

The variables update on every scene push and on resize, so picking them up via CSS means your typography and sizing stay in lockstep with the rest of the scene without you writing any JS.

> **Why the long font fallback chain?** Cosmos always sets `--cosmos-font-family`, so the `system-ui` *inside* `var()` only fires if the variable were undefined — which it never is. The canvas iframe is sandboxed and can't load Cosmos's bundled `@fontsource` fonts, so the named scene font (e.g. `"Space Grotesk"`) usually fails to resolve. Without a real fallback **after** the `var()`, the browser drops to its ultimate default — Times New Roman on most platforms. The trailing list keeps you on a real sans-serif when the named font isn't loadable.

## Outbound fetches

The iframe sandbox blocks normal `window.fetch` for cross-origin requests, so canvases use `cosmos.fetch(url, init?)`. Under the hood the display browser's parent context performs the request and posts the response back to the iframe.

```js
const res = await cosmos.fetch('https://api.weather.gov/alerts/active?area=NY');
if (res.ok) {
  const json = await res.json();
  // …render
}
```

**Allowlist.** A fresh install denies every fetch. To enable, go to **Admin → Settings → Canvas fetch** and either:

- pick **Allowlist** and enter the hostnames you trust (one per line — `example.com` matches subdomains too), or
- pick **Any** to skip the allowlist entirely (acceptable for a fully self-hosted setup; not recommended when you paste in canvases an LLM wrote).

**Limits.** Schemes other than `http(s)` are rejected. No cookies or `Authorization` from the parent are forwarded. Responses larger than ~2 MB are dropped. A single request times out after 15 seconds. Polling with `setInterval` is the expected pattern.

**Errors.** Rejections from `cosmos.fetch` carry a message starting with `cosmos.fetch:` — surface it in your UI rather than swallow it, since the user might need to add a host to the allowlist or change the mode.

## Sandbox

The iframe runs with `sandbox="allow-scripts"`. The browser enforces:

- **Origin is `null`** — no access to parent storage or cookies, no same-origin fetches, no top-level navigation.
- **No forms, popups, plugins, pointer-lock, or modals.**
- **Cross-origin `@font-face` loading fails** — use system fonts (Cosmos passes a sensible `cosmos.font.family`) or embed fonts as data URLs.
- **Network requests** must go through `cosmos.fetch` (see above). Direct `window.fetch` works only against URLs that send permissive CORS headers, which most won't.

If you find yourself wanting to break out of these constraints, you almost certainly want a different widget kind — entity tile, statistics, or media player.

## One canvas per scene (recommendation)

Wall tablets run 24/7. Each iframe carries its own JS engine instance, layout tree, paint pipeline, and any animation loops you start. Two heavy canvases on the same scene measurably hurt frame rate and memory headroom on a Raspberry Pi tablet.

The editor doesn't enforce a single canvas — there are legitimate cases (a quick toggle next to a stats panel) — but the default assumption in performance budgets is one.

## Authoring tips

- **Size to 100%, not pixels.** Every canvas should fit any cell:
  ```html
  <div style="width:100%;height:100%;display:grid;place-items:center">…</div>
  ```
- **Listen for resize.** If your layout depends on `cosmos.size`, recompute on `cosmos:resize`:
  ```js
  window.addEventListener('cosmos:resize', layout);
  ```
- **Prefer SVG over Canvas.** SVG re-flows for free; `<canvas>` requires manual repaint.
- **Avoid hot animation loops.** A tablet rendering a 60fps `requestAnimationFrame` loop will eat battery and CPU. Use CSS animations / transitions whenever possible.
- **Match the scene typography.** Apply `cosmos.font.family` to your root element so the canvas matches the surrounding scene.
- **Keep it small.** The editor warns past 50KB. Larger payloads work but ship slower over WS and re-parse on every content change.

## Worked examples

The "Insert example" dropdown in the editor seeds five starters:

1. **Hello world** — static text + a `cosmos.size` readout. The "did the bridge work?" smoke test.
2. **Templated entity card** — one Jinja template + a styled box. No JS. Demonstrates the most common shape.
3. **Live gauge** — subscribes to a sensor, animates an SVG arc. The minimum viable JS canvas.
4. **Recipe card** — pure static HTML, no templates, no JS. Useful for ambient information.
5. **Sun-driven palette** — subscribes to `sun.sun` and swaps CSS variables to repaint the canvas at sunrise/sunset.

Each example is a self-contained ~30–60 line snippet you can copy, modify, and ship.

## Troubleshooting

**My template renders as `{{ states(...) }}` literally.**
Cosmos isn't connected to HA, or the template engine isn't initialised yet. Check the addon log for `Home Assistant connected` near startup. In dev mode (no HA), templates always pass through unrendered.

**My fetch() returns CORS errors.**
Use `cosmos.fetch(url)` instead of `window.fetch(url)` — the bridge variant runs in the parent context and isn't subject to the iframe's null-origin CORS wall. You'll also need to add the host to the allowlist at *Admin → Settings → Canvas fetch*; the default policy denies everything.

**My font doesn't load.**
Cross-origin `@font-face` fails because of the null origin. Use system fonts via `cosmos.font.family`, or inline the font as a base64 data URL inside `@font-face`.

**Updates don't arrive.**
Confirm the entity id is exactly what HA reports (case-sensitive). Use `cosmos.entity('sensor.foo')` from the iframe console to verify. If it returns null, the parent hasn't pushed it yet — check that the entity exists in HA Developer Tools.

**The whole iframe is blank.**
Open browser devtools, navigate the iframe context, check the console. Unhandled errors in your `<script>` block silently abort the rest. Wrap in try/catch during development.
