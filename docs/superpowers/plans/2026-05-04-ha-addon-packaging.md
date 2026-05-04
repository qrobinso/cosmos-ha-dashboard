# Cosmos HA Add-on Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap Cosmos as an installable Home Assistant add-on. A user with HA OS or HA Supervised adds the Cosmos repository in the HA UI, installs the "Cosmos" add-on, and gets: a Docker container Supervisor manages, automatic Supervisor token + MQTT broker discovery, persistent SQLite at `/data`, and the editor mounted as a sidebar panel inside HA via Ingress. No manual env vars, no curl commands required.

**Architecture:** New top-level `addon/` directory with the HA-add-on contract: `config.yaml` (manifest with options + ingress + panel), `Dockerfile` (multi-stage build: Node build of server + display, runtime layer based on HA's Alpine base image), `run.sh` (entrypoint that reads `/data/options.json`, queries Supervisor for Core URL/Token + MQTT broker, exec's the server). A small server-side change auto-detects Supervisor (`SUPERVISOR_TOKEN` env var) and uses the Supervisor proxy URL for HA, plus calls Supervisor's services API to find the MQTT broker. A repository manifest (`repository.yaml` at repo root) makes the whole repo HACS-add-on-installable.

**Tech Stack:** Same as Plans 1–5, plus `docker buildx` for multi-arch images and HA's `ghcr.io/hassio-addons/base` Alpine images. No new Node deps.

---

## Common Conventions

- Branch off `main`: `git checkout main && git checkout -b cosmos-ha-addon`.
- TDD on Node code; the add-on packaging itself is verified via `docker build` (no automated test, but a smoke build step in the plan).
- All paths inside the add-on container are absolute: `/app` for code, `/data` for state.
- The add-on uses Ingress: HA proxies the add-on's HTTP through `/api/hassio_ingress/<token>/...`. The server already serves SPA fallback so this works without code changes.

---

## File Structure

New files:

```
repository.yaml              # HA add-on repository manifest (top-level)
README.md                    # already exists; add an "Install as HA add-on" section
addon/
  config.yaml                # HA add-on manifest
  Dockerfile                 # multi-stage build (builder + runtime)
  build.yaml                 # base image refs per architecture
  run.sh                     # entrypoint script
  DOCS.md                    # add-on user-facing docs (rendered by HA)
  CHANGELOG.md               # version history (rendered by HA)
  icon.png                   # 256x256 add-on icon (placeholder for v1)
  logo.png                   # 250x100 add-on logo (placeholder for v1)
  translations/
    en.yaml                  # English translations for option labels
server/src/
  ha/supervisor.ts           # Supervisor service-discovery helpers (HA URL/token, MQTT)
```

Modified files:

```
server/src/index.ts          # auto-detect SUPERVISOR_TOKEN; query MQTT discovery
server/src/config.ts         # `supervisorToken` field
.gitignore                   # ignore addon-build artifacts
CLAUDE.md                    # Plan 6 docs
server/CLAUDE.md             # supervisor.ts module
```

---

## Task 0: Plan 5 carry-over fixes

Two non-blocking items called out in Plan 5's review: gradient minimum-2-colors enforcement, and entity picker empty-state guard.

**Files:**
- Modify: `display/src/routes/admin/scenes/[id]/+page.svelte`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git checkout -b cosmos-ha-addon
```

- [ ] **Step 2: Add minimum-colors guard in scene editor**

In `display/src/routes/admin/scenes/[id]/+page.svelte`, find the `removeColor` function:

```ts
  function removeColor(idx: number) {
    if (background.type !== 'gradient') return;
    background = { ...background, colors: background.colors.filter((_, i) => i !== idx) };
  }
```

Replace with:

```ts
  function removeColor(idx: number) {
    if (background.type !== 'gradient') return;
    if (background.colors.length <= 2) return; // gradient needs at least 2 colors
    background = { ...background, colors: background.colors.filter((_, i) => i !== idx) };
  }
```

- [ ] **Step 3: Add entity picker empty-state**

Find the entity_tile config select:

```svelte
          {:else if w.kind === 'entity_tile'}
            <Field label="Entity">
              <select value={(w.config.entity_id as string) ?? ''} on:change={(e) => { w.config = { ...w.config, entity_id: e.currentTarget.value }; widgets = widgets; }}>
                {#each entities as e (e.entity_id)}<option value={e.entity_id}>{e.entity_id}</option>{/each}
              </select>
            </Field>
```

Replace the `<select>` block with:

```svelte
          {:else if w.kind === 'entity_tile'}
            <Field label="Entity">
              <select value={(w.config.entity_id as string) ?? ''} on:change={(e) => { w.config = { ...w.config, entity_id: e.currentTarget.value }; widgets = widgets; }}>
                <option value="">— Select entity —</option>
                {#each entities as e (e.entity_id)}<option value={e.entity_id}>{e.entity_id}</option>{/each}
              </select>
              {#if entities.length === 0}<span class="hint">No entities cached. Set HA_URL/HA_TOKEN or add a real entity to your scene config.</span>{/if}
            </Field>
```

- [ ] **Step 4: Build + commit**

```bash
npm --workspace display run build
git add display/src/routes/admin/scenes/[id]/+page.svelte
git commit -m "fix(display): enforce gradient min-2-colors and add entity picker empty state"
```

---

## Task 1: Supervisor discovery helpers

The add-on runtime gets `SUPERVISOR_TOKEN` injected automatically. Cosmos uses it to call:

- `GET http://supervisor/services/mqtt` to find the configured MQTT broker (returns host, port, username, password if a Mosquitto add-on is installed).
- HA Core API at `http://supervisor/core/...` (the Supervisor proxies to HA) — but the existing HA websocket client connects via `ha_url` which we pass as `http://supervisor/core` in the add-on context.

These calls happen at startup in `index.ts`. A small helper module wraps the fetch logic so it's testable.

**Files:**
- Create: `server/src/ha/supervisor.ts`
- Create: `server/test/supervisor.test.ts`

- [ ] **Step 1: Write failing test `server/test/supervisor.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMqttFromSupervisor, type SupervisorMqttResult } from '../src/ha/supervisor.js';

const fetchSpy = vi.spyOn(global, 'fetch');

afterEach(() => {
  fetchSpy.mockReset();
});

describe('fetchMqttFromSupervisor', () => {
  it('returns connection details when Supervisor reports an MQTT service', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { host: 'core-mosquitto', port: 1883, username: 'addon', password: 'pw', ssl: false } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const result = await fetchMqttFromSupervisor('http://supervisor', 'tok');
    expect(result).toEqual<SupervisorMqttResult>({
      url: 'mqtt://addon:pw@core-mosquitto:1883',
    });
  });

  it('omits credentials when no username is configured', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { host: 'broker', port: 1883, ssl: false } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const result = await fetchMqttFromSupervisor('http://supervisor', 'tok');
    expect(result).toEqual({ url: 'mqtt://broker:1883' });
  });

  it('uses mqtts:// when Supervisor reports ssl=true', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { host: 'broker', port: 8883, ssl: true } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const result = await fetchMqttFromSupervisor('http://supervisor', 'tok');
    expect(result).toEqual({ url: 'mqtts://broker:8883' });
  });

  it('returns null when Supervisor responds 400 (no MQTT service)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('no mqtt', { status: 400 }));
    const result = await fetchMqttFromSupervisor('http://supervisor', 'tok');
    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('boom'));
    const result = await fetchMqttFromSupervisor('http://supervisor', 'tok');
    expect(result).toBeNull();
  });

  it('passes Bearer token in the Authorization header', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { host: 'b', port: 1883, ssl: false } }),
        { status: 200 }
      )
    );
    await fetchMqttFromSupervisor('http://supervisor', 'tok');
    const req = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((req.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});
```

- [ ] **Step 2: Run, see fail**

```bash
npm --workspace server test -- supervisor
```

Expected: module-not-found.

- [ ] **Step 3: Create `server/src/ha/supervisor.ts`**

```ts
export type SupervisorMqttResult = {
  url: string;
};

type SupervisorMqttPayload = {
  data?: {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    ssl?: boolean;
  };
};

export async function fetchMqttFromSupervisor(
  supervisorBase: string,
  token: string
): Promise<SupervisorMqttResult | null> {
  try {
    const res = await fetch(`${supervisorBase}/services/mqtt`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SupervisorMqttPayload;
    const data = body.data;
    if (!data || typeof data.host !== 'string' || typeof data.port !== 'number') return null;
    const protocol = data.ssl ? 'mqtts' : 'mqtt';
    const auth =
      typeof data.username === 'string' && data.username.length > 0
        ? `${encodeURIComponent(data.username)}:${encodeURIComponent(data.password ?? '')}@`
        : '';
    return { url: `${protocol}://${auth}${data.host}:${data.port}` };
  } catch {
    return null;
  }
}

export const SUPERVISOR_BASE = 'http://supervisor';
export const SUPERVISOR_HA_URL = 'http://supervisor/core';
```

- [ ] **Step 4: Run, see pass**

```bash
npm --workspace server test -- supervisor
```

Expected: 6 tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm --workspace server test
```

Expected: 97 tests pass (was 91, +6 new).

- [ ] **Step 6: Commit**

```bash
git add server/src/ha/supervisor.ts server/test/supervisor.test.ts
git commit -m "feat(server): add Supervisor MQTT discovery helper"
```

---

## Task 2: Wire Supervisor auto-detection in index.ts

When `SUPERVISOR_TOKEN` is set and `HA_URL` / `MQTT_URL` are not, fall back to Supervisor: use `http://supervisor/core` for HA and call `fetchMqttFromSupervisor` for MQTT.

**Files:**
- Modify: `server/src/config.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add `supervisorToken` to config**

In `server/src/config.ts`, add:

```ts
  supervisorToken: process.env.SUPERVISOR_TOKEN ?? null,
```

So the full file becomes:

```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

export const config = {
  port: Number(process.env.PORT ?? 8099),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? resolve(repoRoot, 'data', 'cosmos.db'),
  staticDir: process.env.STATIC_DIR ?? resolve(repoRoot, 'display', 'build'),
  haUrl: process.env.HA_URL ?? null,
  haToken: process.env.HA_TOKEN ?? null,
  mqttUrl: process.env.MQTT_URL ?? null,
  supervisorToken: process.env.SUPERVISOR_TOKEN ?? null,
};
```

- [ ] **Step 2: Update HA + MQTT setup in `server/src/index.ts`**

Find the existing HA setup block:

```ts
  let haClient: HaClient | null = null;
  if (config.haUrl && config.haToken) {
    try {
      console.log(`connecting to Home Assistant at ${config.haUrl}`);
      haClient = await makeHaClient({ url: config.haUrl, token: config.haToken });
      ...
```

Replace it with this version that prefers Supervisor when available:

```ts
  // Resolve effective HA + MQTT settings, falling back to Supervisor when running as an add-on.
  const { fetchMqttFromSupervisor, SUPERVISOR_HA_URL, SUPERVISOR_BASE } = await import('./ha/supervisor.js');
  const effectiveHaUrl = config.haUrl ?? (config.supervisorToken ? SUPERVISOR_HA_URL : null);
  const effectiveHaToken = config.haToken ?? config.supervisorToken;
  let effectiveMqttUrl = config.mqttUrl;
  if (!effectiveMqttUrl && config.supervisorToken) {
    const result = await fetchMqttFromSupervisor(SUPERVISOR_BASE, config.supervisorToken);
    if (result) {
      effectiveMqttUrl = result.url;
      console.log(`MQTT broker discovered via Supervisor: ${result.url.replace(/:[^:@/]*@/, ':***@')}`);
    } else {
      console.log('Supervisor reports no MQTT service available');
    }
  }

  let haClient: HaClient | null = null;
  if (effectiveHaUrl && effectiveHaToken) {
    try {
      console.log(`connecting to Home Assistant at ${effectiveHaUrl}`);
      haClient = await makeHaClient({ url: effectiveHaUrl, token: effectiveHaToken });
      await haClient.ready();
      console.log('Home Assistant connected; entity cache populated');
    } catch (err) {
      console.error('Home Assistant connection failed; falling back to mock entity data', err);
      haClient = null;
    }
  } else {
    console.log('HA_URL/HA_TOKEN not set and no Supervisor token; using mock entity data');
  }
```

Then find the MQTT setup block:

```ts
  if (config.mqttUrl) {
    try {
      console.log(`connecting to MQTT at ${config.mqttUrl}`);
      const { makeMqttClient } = await import('./mqtt/client.js');
      mqttClient = await makeMqttClient(config.mqttUrl);
      ...
```

Replace `config.mqttUrl` with `effectiveMqttUrl` in both the condition and the connect call:

```ts
  if (effectiveMqttUrl) {
    try {
      console.log(`connecting to MQTT at ${effectiveMqttUrl.replace(/:[^:@/]*@/, ':***@')}`);
      const { makeMqttClient } = await import('./mqtt/client.js');
      mqttClient = await makeMqttClient(effectiveMqttUrl);
      ...
```

And the `else` branch:

```ts
  } else {
    console.log('MQTT not configured; overlay commands unavailable');
  }
```

- [ ] **Step 3: Build**

```bash
npm --workspace server run build
```

Expected: exit 0.

- [ ] **Step 4: Run full suite**

```bash
npm --workspace server test
```

Expected: 97 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/src/index.ts
git commit -m "feat(server): auto-detect Supervisor token for HA + MQTT"
```

---

## Task 3: Add-on `config.yaml` + `build.yaml`

The HA add-on manifest. This is the contract between Cosmos and Supervisor: declares the slug, ports, options schema, ingress, panel, and what services Cosmos expects from HA.

**Files:**
- Create: `addon/config.yaml`
- Create: `addon/build.yaml`

- [ ] **Step 1: Create `addon/config.yaml`**

```yaml
name: Cosmos
version: "0.1.0"
slug: cosmos_dashboard
description: A beautiful wall dashboard for Home Assistant.
url: https://github.com/qrobinso/cosmos-dashboard
arch:
  - amd64
  - aarch64
init: false
hassio_api: true
homeassistant_api: true
auth_api: true
mqtt: true
host_network: false
ingress: true
ingress_port: 8099
panel_icon: mdi:television-classic
panel_title: Cosmos
panel_admin: true
ports:
  8099/tcp: 8099
ports_description:
  8099/tcp: Cosmos web (kiosk + admin). Tablet displays connect here.
map:
  - addon_config:rw
options:
  log_level: info
schema:
  log_level: list(trace|debug|info|notice|warning|error|fatal)
image: ghcr.io/qrobinso/cosmos-dashboard-{arch}
```

The key fields:

- `ingress: true` + `ingress_port: 8099` — HA proxies the admin UI through `/api/hassio_ingress/...`.
- `panel_icon`, `panel_title`, `panel_admin: true` — registers a sidebar panel in HA that loads the ingress URL.
- `hassio_api`, `homeassistant_api`, `auth_api`, `mqtt: true` — declares which Supervisor services Cosmos needs. `mqtt: true` makes Supervisor expose the MQTT broker to the add-on.
- `ports: 8099/tcp: 8099` — exposes the kiosk URL on the host so tablets on the LAN can reach it.

- [ ] **Step 2: Create `addon/build.yaml`**

This file maps `{arch}` in the `image` to base images per architecture.

```yaml
build_from:
  amd64: ghcr.io/hassio-addons/base:15.0.7
  aarch64: ghcr.io/hassio-addons/base:15.0.7
```

- [ ] **Step 3: Commit**

```bash
git add addon/config.yaml addon/build.yaml
git commit -m "feat(addon): add HA add-on manifest + build config"
```

---

## Task 4: Add-on `Dockerfile` + `run.sh`

Multi-stage Docker build: a Node builder stage compiles `server/` and `display/`, a runtime stage based on the HA add-on Alpine base image runs the server.

**Files:**
- Create: `addon/Dockerfile`
- Create: `addon/run.sh`
- Modify: `.gitignore`

- [ ] **Step 1: Create `addon/Dockerfile`**

```dockerfile
ARG BUILD_FROM
# --- builder stage ---
FROM node:20-alpine AS builder

# Native deps for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /build
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY display/package.json display/
RUN npm ci

# Copy sources and build both packages
COPY server ./server
COPY display ./display
RUN npm run build

# Prune devDependencies for the runtime image
RUN npm prune --workspace server --omit=dev

# --- runtime stage ---
FROM ${BUILD_FROM}

# Install Node 20 + tini for clean PID-1 handling
RUN apk add --no-cache nodejs npm

WORKDIR /app

# Server runtime
COPY --from=builder /build/server/package.json /app/server/package.json
COPY --from=builder /build/server/dist /app/server/dist
COPY --from=builder /build/node_modules /app/node_modules
COPY --from=builder /build/server/node_modules /app/server/node_modules

# Display static build
COPY --from=builder /build/display/build /app/display/build

# Add-on entrypoint
COPY addon/run.sh /run.sh
RUN chmod a+x /run.sh

ENV NODE_ENV=production \
    PORT=8099 \
    HOST=0.0.0.0 \
    DB_PATH=/data/cosmos.db \
    STATIC_DIR=/app/display/build

# Mount points provided by Supervisor:
#   /data — persistent state (SQLite goes here)
#   /addon_config — write-once add-on config (unused by Cosmos)
VOLUME ["/data"]

EXPOSE 8099

CMD ["/run.sh"]
```

- [ ] **Step 2: Create `addon/run.sh`**

```bash
#!/usr/bin/with-contenv bashio
set -e

# bashio is provided by ghcr.io/hassio-addons/base — exposes config, log, etc.
LOG_LEVEL="$(bashio::config 'log_level')"
bashio::log.info "starting Cosmos (log level: ${LOG_LEVEL})"

# Pass the Supervisor-injected env vars through to the Node process.
# - SUPERVISOR_TOKEN is auto-injected by Supervisor when hassio_api is true.
# - The Node process detects it and falls back to http://supervisor/core for HA + queries
#   /services/mqtt for the broker.
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN}"
export DB_PATH="${DB_PATH:-/data/cosmos.db}"
export STATIC_DIR="${STATIC_DIR:-/app/display/build}"
export PORT="${PORT:-8099}"
export HOST="${HOST:-0.0.0.0}"

# Forward log level to NODE_DEBUG when relevant. Cosmos uses console.log/error today;
# log_level is wired through here for future structured logging.
case "${LOG_LEVEL}" in
  trace|debug) export NODE_DEBUG="cosmos*" ;;
  *) ;;
esac

cd /app
exec node server/dist/index.js
```

- [ ] **Step 3: Update `.gitignore`** to ignore add-on build artifacts

Append:

```
addon/build/
*.tar
```

- [ ] **Step 4: Commit**

```bash
git add addon/Dockerfile addon/run.sh .gitignore
git commit -m "feat(addon): add Dockerfile + entrypoint script"
```

---

## Task 5: Add-on user-facing docs (DOCS.md, CHANGELOG.md, translations)

HA's add-on UI renders these inside the Supervisor → Add-on details page.

**Files:**
- Create: `addon/DOCS.md`
- Create: `addon/CHANGELOG.md`
- Create: `addon/translations/en.yaml`

- [ ] **Step 1: Create `addon/DOCS.md`**

```markdown
# Cosmos

A beautiful wall dashboard for Home Assistant. Configure scenes, widgets, transitions, and triggers from inside HA, then point any tablet at Cosmos to use it as a kiosk display.

## Installation

1. Install this add-on. The Cosmos sidebar panel appears in HA after install.
2. **(Optional but recommended)** Install the **Mosquitto broker** add-on. Cosmos auto-discovers it via Supervisor and uses it for the message-overlay command topics. Without MQTT, you can still use scenes/widgets/transitions, but `cosmos/<display>/message/set` automations won't work.
3. Open the **Cosmos** sidebar panel and create your first scene.

## Connecting a tablet

Find your HA host's LAN IP. On the tablet's browser, open `http://<HA_IP>:8099/`. The first time, you'll be asked to name the display (e.g. "Living Room"). After that the tablet auto-connects.

## Configuration via HA automations

The MQTT command topics work out-of-the-box once the Mosquitto add-on is running:

```yaml
# Show a toast on the Living Room display
service: mqtt.publish
data:
  topic: cosmos/Living Room/message/set
  payload: '{"title":"Dinner is ready","timeout_ms":5000}'

# Switch the active scene by name
service: mqtt.publish
data:
  topic: cosmos/Living Room/scene/set
  payload: '{"scene_name":"Cooking"}'

# Dismiss any visible message
service: mqtt.publish
data:
  topic: cosmos/Living Room/message/dismiss
  payload: ''
```

## Options

| Option       | Description                                   | Default |
|--------------|-----------------------------------------------|---------|
| `log_level`  | Server log verbosity                          | `info`  |

## Persistence

All scenes, displays, transitions, and settings live in `/data/cosmos.db` inside the add-on. HA persists `/data` across add-on restarts and updates.

## Support

Report issues at <https://github.com/qrobinso/cosmos-dashboard>.
```

- [ ] **Step 2: Create `addon/CHANGELOG.md`**

```markdown
# Changelog

## 0.1.0 - 2026-05-04

Initial release.

- Scenes with widgets (clock, weather, type-aware entity tiles), backgrounds (solid + animated gradient), per-scene typography, global safe-area padding.
- Transition engine: 6 built-in transitions, per-scene defaults, explicit overrides.
- Reactive HA entity-driven scene push.
- MQTT discovery + command topics for messages and scene activation.
- Sidebar panel admin editor at `/admin`.
```

- [ ] **Step 3: Create `addon/translations/en.yaml`**

```yaml
configuration:
  log_level:
    name: Log level
    description: Verbosity of the Cosmos server logs. `trace`/`debug` enable verbose Node logging.
network:
  8099/tcp: Web UI port (kiosk + admin).
```

- [ ] **Step 4: Commit**

```bash
git add addon/DOCS.md addon/CHANGELOG.md addon/translations/en.yaml
git commit -m "docs(addon): add DOCS, CHANGELOG, translations"
```

---

## Task 6: Repository manifest (HACS-compatible add-on repo)

A `repository.yaml` at the repo root tells HA's Supervisor that this Git repository is an add-on repository. Users add the repo URL in the HA UI; Cosmos appears in their add-on store.

**Files:**
- Create: `repository.yaml`
- Modify: `README.md`

- [ ] **Step 1: Create `repository.yaml`**

```yaml
name: Cosmos
url: https://github.com/qrobinso/cosmos-dashboard
maintainer: Quentin Robinson <qrobinso@gmail.com>
```

- [ ] **Step 2: Append to `README.md`**

After the existing content, add:

```markdown
## Install as a Home Assistant add-on

In Home Assistant, go to **Settings → Add-ons → Add-on Store → ⋮ menu → Repositories**. Add `https://github.com/qrobinso/cosmos-dashboard`. Cosmos will appear under "Local add-ons" / "Cosmos". Install it. The Cosmos sidebar panel appears after install.

For details, see [`addon/DOCS.md`](addon/DOCS.md).
```

- [ ] **Step 3: Commit**

```bash
git add repository.yaml README.md
git commit -m "feat(addon): add repository manifest for HACS-compatible install"
```

---

## Task 7: Local add-on build smoke

Build the add-on image locally to verify the Dockerfile compiles and the runtime starts. This does NOT install into HA — that requires HA OS or HA Supervised, which is out of scope for an automated smoke. The build alone catches Dockerfile bugs (missing files, wrong paths, deps that don't install).

**Files:** none new. Just verify the build.

- [ ] **Step 1: Build the image**

From repo root:

```bash
docker buildx build \
  --build-arg BUILD_FROM=ghcr.io/hassio-addons/base:15.0.7 \
  -f addon/Dockerfile \
  -t cosmos-dashboard:smoke \
  --load \
  .
```

Expected: image builds without errors. The final image is named `cosmos-dashboard:smoke`.

If the build fails because `npm prune --workspace server --omit=dev` doesn't work as expected (older npm), substitute the prune step with manually copying only `server/dist` and reinstalling production deps:

```dockerfile
# Replace the prune step in the builder stage with:
WORKDIR /build/server
RUN npm install --omit=dev --no-package-lock
WORKDIR /build
```

- [ ] **Step 2: Run the image briefly to confirm the server starts**

```bash
docker run --rm \
  -e SUPERVISOR_TOKEN=test-token \
  -p 8099:8099 \
  --name cosmos-smoke \
  cosmos-dashboard:smoke &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8099/
docker stop cosmos-smoke 2>/dev/null
```

Expected:
- Container starts.
- HTTP `200` from the root URL (the SvelteKit app loads).
- Logs show "cosmos server listening on http://0.0.0.0:8099" and a Supervisor MQTT discovery attempt that fails with a connection error (since `http://supervisor` doesn't resolve in a standalone Docker run — that's expected).

If `docker buildx` is not available locally, fall back to `docker build` with the same arg. If Docker itself isn't installed, skip this task and document in the commit message that the smoke was deferred to HA-OS install verification.

- [ ] **Step 3: No commit needed** — this is a verification task only.

If you needed to modify the Dockerfile based on issues encountered, commit those changes:

```bash
git add addon/Dockerfile
git commit -m "fix(addon): adjust Dockerfile for local build (npm prune workaround)"
```

---

## Task 8: CLAUDE.md updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `server/CLAUDE.md`

- [ ] **Step 1: Update root `CLAUDE.md`**

In Architecture, add a bullet:

```markdown
- `addon/` — Home Assistant add-on packaging: `config.yaml` (manifest with ingress + panel), `Dockerfile` (multi-stage build), `run.sh` (entrypoint), `DOCS.md` / `CHANGELOG.md` / `translations/en.yaml`. The add-on auto-discovers the Supervisor token + MQTT broker; users install it from the HA add-on store after adding `https://github.com/qrobinso/cosmos-dashboard` as a repository.
```

In Roadmap, replace Plan 6:

```markdown
- Plan 6: ✅ Shipped — installable HA add-on with Supervisor auto-discovery, Ingress sidebar panel, multi-arch Docker images.
```

- [ ] **Step 2: Update `server/CLAUDE.md`**

In Layout, add:

```markdown
- `src/ha/supervisor.ts` — helpers for Supervisor service discovery. When `SUPERVISOR_TOKEN` is set (i.e. running as an HA add-on), the server falls back to `http://supervisor/core` for HA Core API and queries `http://supervisor/services/mqtt` for the broker URL.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md server/CLAUDE.md
git commit -m "docs: update CLAUDE.md for HA add-on packaging"
```

---

## Done criteria

- `npm test` is green for the server (97 tests).
- `addon/config.yaml`, `addon/Dockerfile`, `addon/run.sh`, `addon/DOCS.md`, `addon/CHANGELOG.md`, `addon/translations/en.yaml`, and `repository.yaml` all exist.
- A `docker build` of the add-on image succeeds locally (or is documented as deferred if Docker is unavailable).
- A user with HA OS or HA Supervised can add the repository URL, install the Cosmos add-on, and have it just work — no manual env vars.
- The HA sidebar shows a "Cosmos" panel that loads the editor via Ingress.
- MQTT broker is auto-discovered when the Mosquitto add-on is running; falls back gracefully when it isn't.

This is the final plan in the v1 roadmap. After Plan 6 ships, Cosmos is feature-complete for v1: a wall dashboard installable as a single add-on, with a polished editor surfaced inside HA.
