# Cosmos Dashboard

Wall dashboard for Home Assistant. See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for implementation plans.

## Development

```bash
npm install
npm run dev:server   # http://localhost:8099
npm run dev:display  # http://localhost:5173
npm test
```

## Authoring with an LLM agent

Want Claude Code, OpenCode, Cursor, or another agent to write a custom canvas widget for your wall? See [`docs/getting-started-with-agents.md`](docs/getting-started-with-agents.md) — it covers both the paste flow and the direct-send (agent calls the Cosmos REST API) flow.

## Install as a Home Assistant app

> Home Assistant renamed "add-ons" to "apps" in 2026. The terminology below reflects the current UI; older versions used the **Settings → Add-ons** path.

In Home Assistant, go to **Settings → Apps → App Store → ⋮ menu → Repositories**. Add `https://github.com/qrobinso/cosmos-ha-dashboard`. Cosmos will appear under "Local apps" / "Cosmos". Install it. The Cosmos sidebar panel appears after install.

For details, see [`addon/DOCS.md`](addon/DOCS.md).
