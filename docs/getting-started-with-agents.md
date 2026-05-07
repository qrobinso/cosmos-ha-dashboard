# Getting started with an agent

You want Cosmos to generate scenes and canvas widgets from natural-language asks. This guide covers the three flows that get you there, in order of how much external setup they need.

If you'd rather author canvases by hand, see [canvas-widget.md](./canvas-widget.md).

## Pick a flow

| Flow | When to use | What you need |
|---|---|---|
| **In-product** ⭐ | Recommended. You want to type "make me a kitchen morning tile" inside Cosmos and have it land. Streamed responses, tool-call confirmations, your full HA entity catalog injected. | An OpenRouter API key |
| **Paste** | Air-gapped LLM; you want manual review before anything ships. | Just the contract markdown — paste into ChatGPT / Claude / etc. |
| **Direct-send** | External agent (Cursor, Claude Code, etc.) that can already reach your Cosmos URL on the network. | Contract markdown + your Cosmos base URL |

All three produce the same artifacts (Scene + canvas HTML); they differ in how the work flows.

## What a canvas widget is, in one paragraph

A canvas widget is a sandboxed iframe inside a single grid cell of a scene. You give it an HTML document. Inside that document, anything in `{{ ... }}` is rendered by Home Assistant's own Jinja engine, so `{{ states("sensor.power") }}` is live. The widget owns its own layout, styling, and behavior — Cosmos just hosts and re-renders it. That makes "have an agent write me a custom dashboard tile" a single-document task.

## The in-product flow (recommended)

Cosmos ships with an in-product agent at `/admin/agent`. You type what you want; it calls a model via [OpenRouter](https://openrouter.ai), inspects your scenes, and creates / patches widgets directly. No copy-paste loop.

### One-time setup

1. Get an OpenRouter API key (free tier works for trying things out).
2. Open `/admin/settings` → **AI agent** card. Paste your key. Pick a model (default: `anthropic/claude-sonnet-4-6`; anything from [openrouter.ai/models](https://openrouter.ai/models) works).
3. Save.

### Using it

Click **Ask the agent** on the admin home, or hit `/admin/agent` directly. Then just type:

- *"List my scenes."* → reads `list_scenes`, summarises.
- *"Make a kitchen morning scene with the time and a sunrise gradient."* → calls `create_scene` with a sensible payload.
- *"Change the canvas on the Energy scene to use blue accents."* → finds the canvas via `list_widgets`, patches it via `update_widget_content`.
- *"Activate the Morning scene on Living Room."* → calls `activate_scene`. **You confirm with a button before it lands.**

### What's safe

- The agent's tool surface is **read + edit**: it can list, get, create, and patch. It cannot send messages, execute service calls on Home Assistant, or touch anything outside the Cosmos scene/widget surface.
- Three actions are gated behind a confirm card: `activate_scene`, `delete_scene`, `delete_widget`. The agent surfaces them in the chat with **Confirm** / **Reject** buttons; nothing irreversible happens until you click.
- Your conversation history persists in browser localStorage. Clear it with the **Clear** button at the top of the chat.
- Your API key stays on the Cosmos server (SQLite settings table). The browser never sees it. Plain text on disk — same posture as Cosmos's other settings.

## The paste flow (3 steps)

1. **Grab the contract.** In your running Cosmos, open `/admin/docs`. Pick **Canvas widget — agent contract** from the sidebar. Click **Copy markdown**.
2. **Brief the agent.** Paste the markdown into your agent as a system prompt (or initial message). Then describe what you want — theme, what data to show, layout, the entity_ids you want it to read. Example: *"Build me a kitchen morning tile. Show indoor temperature from `sensor.kitchen_temp`, the next garbage pickup from `sensor.next_pickup`, and a soft sunrise gradient. Inter font, calm colors."*
3. **Land the HTML.** The agent gives you back one self-contained HTML document. In the Cosmos admin editor: open or create a scene → **+ Add widget → Canvas (HTML/JS)** → paste into the **Content** textarea → Save. The kiosk picks it up live.

That's it. Iterate by handing screenshots and errors back to the agent and re-pasting the result.

## The direct-send flow

If your agent can reach the Cosmos URL on the network, it can post the scene itself — no copy-paste loop.

**Reachability:** the URL is `http://localhost:8099` if the agent runs on the same machine as the Cosmos server, `http://<host>:8099` on your LAN, or your Home Assistant Ingress URL when Cosmos runs as an HA app.

**What to give the agent:**
- **Both contracts.** [canvas-widget-agent.md](./canvas-widget-agent.md) (HTML/JS rules) and [scene-agent.md](./scene-agent.md) (REST flow). Both are available via Copy markdown at `/admin/docs`.
- **Your Cosmos base URL** and **a display name** (the wall the scene should land on). For example: *"Cosmos is at http://192.168.1.50:8099, target display is `kitchen-wall`."*

**The loop the agent will run:**
1. `POST /api/scenes` with a scene that contains one canvas widget at `{ col: 1, row: 1, w: 12, h: 8 }` filling the whole grid. The HTML goes in `widgets[0].config.content`.
2. `POST /api/displays/{name}/scene/activate { "sceneId": "<id>" }` — the kiosk transitions to the new scene.
3. For revisions, `PUT /api/scenes/:id` with the updated `widgets[0].config.content`. The kiosk reactively re-renders without a full transition.

The agent should `PUT` to update during iteration rather than `POST`-ing a brand-new scene each time, so your scene list stays clean.

## Iterating without a full scene

While the agent is iterating, open `/preview-canvas?id=<widgetId>` in a browser — that's a chrome-free preview of just the canvas, no scene background or other widgets. Handy for sending screenshots back to the agent without the rest of the scene in frame.

## Caveats

- **No auth.** The Cosmos REST API has no authentication today. On a home LAN this is fine; don't expose port 8099 publicly while running this loop.
- **The agent's only output is HTML.** It should not be writing files in the Cosmos repo, installing dependencies, or running builds. The contracts say this; it's repeated here so you know what to push back on.
- **Sandbox is real.** Canvas iframes run with `sandbox="allow-scripts"` only — no same-origin, no top navigation, no parent DOM. The agent gets a small `window.cosmos.*` bridge for entity reads and that's it. If the agent's HTML "doesn't work," that's almost always why; the contract covers what's available.
- **Templates are HA Jinja.** `{{ states("...") }}` is rendered by your Home Assistant instance, not by the agent. Errors come back from HA verbatim.

## Pointers

- [canvas-widget-agent.md](./canvas-widget-agent.md) — the HTML/JS contract. Hand to your agent.
- [scene-agent.md](./scene-agent.md) — the REST flow. Hand to your agent for direct-send.
- [canvas-widget.md](./canvas-widget.md) — the same widget, by hand. For when you want to know what the agent is doing under the hood.
