# Canvas widget — agent contract

This document is intended to be pasted into an LLM agent's system prompt or pulled in as a tool/reference document. It describes exactly what the agent should output when generating canvas widget content for Cosmos.

## Contract

You are emitting a complete HTML body for a Cosmos canvas widget. Output ONLY the HTML; no markdown fences, no preamble, no closing chatter. The output should be ready to drop into the widget's `content` field.

Example completion:

```html
<div style="display:grid;place-items:center;width:100%;height:100%;font-family:system-ui;color:#f5f5f5">
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

### JS API (in-iframe, exposed as `window.cosmos`)

```ts
cosmos.ready: Promise<void>
cosmos.size: { w: number; h: number }
cosmos.scene: { id: string; name: string }
cosmos.font: { family: string; scale: number }
cosmos.version: string

cosmos.entity(id: string): EntityState | null
cosmos.subscribe(id: string, cb: (e: EntityState) => void): () => void

type EntityState = { entity_id: string; state: string; attributes: Record<string, unknown> }
```

Subscribe is the live binding; reach for it when an animation needs to react to state.

### Resize event

`window.addEventListener('cosmos:resize', () => recompute())` fires when `cosmos.size` changes.

## What's forbidden

- `<script src="https://...">` — cross-origin scripts won't load. Inline scripts only.
- `fetch()` to Cosmos's API or to HA — origin is `null`; same-origin requests are blocked. Public CORS-permissive URLs work.
- Service calls — there is no `cosmos.callService`. The agent cannot turn lights on/off; describe state, do not mutate it.
- Top-frame navigation, popups, forms, pointer-lock — sandboxed away by the browser.
- `@font-face` loading from cross-origin URLs — embed fonts as data URLs if you must.

## Style hints

- Always size your root to `width: 100%; height: 100%`. The canvas fills its grid cell, which is variable.
- Use `cosmos.font.family` so the canvas blends with the surrounding scene typography.
- Prefer light, airy layouts. Cosmos kiosk surfaces are usually viewed from across a room.
- Pure-CSS animations beat JS animations. Use `requestAnimationFrame` only when CSS can't express the effect.
- Keep total document under 50,000 characters. Larger payloads slow scene pushes.

## Completion shapes

### "Number card" — show one HA value with a label

```html
<div style="padding:1.5rem;font-family:system-ui;color:#f5f5f5">
  <div style="opacity:0.6;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em">{LABEL}</div>
  <div style="font-size:3rem;font-weight:200;line-height:1.1">{{ states("{ENTITY}") }} {UNIT}</div>
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
<div style="padding:1rem;font-family:system-ui;color:#f5f5f5">
  <h2 style="margin:0;font-weight:300">{TITLE}</h2>
  <p style="margin:0.5rem 0 0;opacity:0.85;line-height:1.5">{BODY}</p>
</div>
```

Replace `{ENTITY}`, `{LABEL}`, `{UNIT}`, `{MAX}`, `{TITLE}`, `{BODY}` with values from the user's intent.
