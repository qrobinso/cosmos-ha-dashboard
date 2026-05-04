# Cosmos Dashboard

Wall dashboard for Home Assistant. See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for implementation plans.

## Development

```bash
npm install
npm run dev:server   # http://localhost:8099
npm run dev:display  # http://localhost:5173
npm test
```

## Install as a Home Assistant add-on

In Home Assistant, go to **Settings → Add-ons → Add-on Store → ⋮ menu → Repositories**. Add `https://github.com/qrobinso/cosmos-dashboard`. Cosmos will appear under "Local add-ons" / "Cosmos". Install it. The Cosmos sidebar panel appears after install.

For details, see [`addon/DOCS.md`](addon/DOCS.md).
