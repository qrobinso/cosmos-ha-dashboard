# Cosmos Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the smallest end-to-end loop for Cosmos: a Node/TypeScript server with a SQLite store and HTTP+WebSocket API, plus a SvelteKit display app that a tablet's browser loads, sets a display name, connects via WebSocket, and renders a server-pushed greeting.

**Architecture:** Two-package npm workspace (`server/`, `display/`) inside one repo. Server uses Fastify for HTTP + `ws` for WebSockets, `better-sqlite3` for persistence. SvelteKit display app is built with `adapter-static` and the resulting files are served by Fastify from the same origin (no CORS). No HA, no MQTT, no scenes yet — those come in later plans. Tests use Vitest on both sides.

**Tech Stack:** Node 20+, TypeScript, Fastify, ws, better-sqlite3, Vitest, SvelteKit, Vite, npm workspaces.

---

## File Structure

Files this plan creates:

```
cosmos-dashboard/
  .gitignore                     # ignore node_modules, build output, /data
  package.json                   # workspace root
  README.md                      # short repo readme
  docs/superpowers/plans/        # already exists from this plan
  data/                          # local dev SQLite location (gitignored)
  server/
    package.json                 # server deps
    tsconfig.json                # TS config
    vitest.config.ts             # test config
    src/
      index.ts                   # entrypoint
      config.ts                  # env vars (PORT, DB_PATH, STATIC_DIR)
      store/
        db.ts                    # SQLite connection
        migrations.ts            # schema migrations runner
        displays.ts              # displays table CRUD
        settings.ts              # settings KV CRUD
      api/
        http.ts                  # Fastify app + REST routes
        ws.ts                    # WebSocket hub
      static.ts                  # serves built SvelteKit app
    test/
      migrations.test.ts
      displays.test.ts
      settings.test.ts
      http.test.ts
      ws.test.ts
  display/
    package.json
    svelte.config.js
    vite.config.ts
    tsconfig.json
    src/
      app.html
      app.d.ts
      lib/
        storage.ts               # localStorage helpers for display name
        ws.ts                    # client WebSocket
      routes/
        +layout.svelte
        +page.svelte             # onboarding + display view
    static/
      favicon.png                # placeholder
```

Each module has one job. The server's `store/` files are pure persistence (no HTTP), `api/` is pure transport (no business logic beyond glue), `static.ts` is purely about file serving. The display app has one route in this plan; future plans add `/admin`.

---

## Task 1: Repo scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Create root `package.json` declaring workspaces**

```json
{
  "name": "cosmos-dashboard",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["server", "display"],
  "scripts": {
    "dev:server": "npm --workspace server run dev",
    "dev:display": "npm --workspace display run dev",
    "build": "npm --workspace display run build && npm --workspace server run build",
    "test": "npm --workspace server run test"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
dist/
build/
.svelte-kit/
data/
*.db
*.db-journal
.env
.env.local
```

- [ ] **Step 3: Create `README.md`**

```markdown
# Cosmos Dashboard

Wall dashboard for Home Assistant. See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for implementation plans.

## Development

```bash
npm install
npm run dev:server   # http://localhost:8099
npm run dev:display  # http://localhost:5173
npm test
```
```

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore README.md
git commit -m "chore: scaffold workspace root"
```

---

## Task 2: Server package skeleton

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/index.ts`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "@cosmos/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "fastify": "^4.28.0",
    "@fastify/static": "^7.0.4",
    "better-sqlite3": "^11.0.0",
    "ws": "^8.17.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.10",
    "@types/node": "^20.12.12",
    "@types/ws": "^8.5.10",
    "tsx": "^4.11.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create placeholder `server/src/index.ts`**

```ts
console.log('cosmos server placeholder');
```

- [ ] **Step 5: Install dependencies**

Run from repo root: `npm install`
Expected: installs server deps; `node_modules/` exists.

- [ ] **Step 6: Verify TypeScript compiles**

Run from repo root: `npm --workspace server run build`
Expected: exit code 0, `server/dist/index.js` created.

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/tsconfig.json server/vitest.config.ts server/src/index.ts package-lock.json
git commit -m "chore(server): scaffold Node/TypeScript package"
```

---

## Task 3: SQLite connection + migrations runner

**Files:**
- Create: `server/src/config.ts`
- Create: `server/src/store/db.ts`
- Create: `server/src/store/migrations.ts`
- Create: `server/test/migrations.test.ts`

- [ ] **Step 1: Create `server/src/config.ts`**

```ts
export const config = {
  port: Number(process.env.PORT ?? 8099),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/cosmos.db',
  staticDir: process.env.STATIC_DIR ?? '../display/build',
};
```

- [ ] **Step 2: Write the failing test `server/test/migrations.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';

describe('runMigrations', () => {
  it('creates displays and settings tables on a fresh database', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('displays');
    expect(names).toContain('settings');
    expect(names).toContain('schema_version');
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db);
    const version = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(version.v).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run from repo root: `npm --workspace server test`
Expected: FAIL with module-not-found for `../src/store/migrations.js`.

- [ ] **Step 4: Create `server/src/store/db.ts`**

```ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

export function openDatabase(path: string): DB {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
```

- [ ] **Step 5: Create `server/src/store/migrations.ts`**

```ts
import type { DB } from './db.js';

type Migration = { version: number; up: string };

const migrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS displays (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        last_seen TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export function runMigrations(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
  const applied = db.prepare('SELECT version FROM schema_version').all() as { version: number }[];
  const appliedSet = new Set(applied.map((r) => r.version));
  const insert = db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)');
  for (const m of migrations) {
    if (appliedSet.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.up);
      insert.run(m.version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run from repo root: `npm --workspace server test`
Expected: PASS — both migration tests green.

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/store/db.ts server/src/store/migrations.ts server/test/migrations.test.ts
git commit -m "feat(server): add SQLite connection and migrations runner"
```

---

## Task 4: Displays repository

**Files:**
- Create: `server/src/store/displays.ts`
- Create: `server/test/displays.test.ts`

- [ ] **Step 1: Write the failing test `server/test/displays.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('displays repo', () => {
  let repo: ReturnType<typeof createDisplaysRepo>;

  beforeEach(() => {
    repo = createDisplaysRepo(freshDb());
  });

  it('registerByName creates a display the first time and returns it', () => {
    const d = repo.registerByName('Living Room');
    expect(d.name).toBe('Living Room');
    expect(d.id).toMatch(/^[a-z0-9-]{8,}$/);
  });

  it('registerByName is idempotent — same name returns the same id', () => {
    const a = repo.registerByName('Kitchen');
    const b = repo.registerByName('Kitchen');
    expect(b.id).toBe(a.id);
  });

  it('list returns all displays', () => {
    repo.registerByName('A');
    repo.registerByName('B');
    expect(repo.list().map((d) => d.name).sort()).toEqual(['A', 'B']);
  });

  it('touch updates last_seen', () => {
    const d = repo.registerByName('Hallway');
    repo.touch(d.id);
    const after = repo.list().find((x) => x.id === d.id)!;
    expect(after.lastSeen).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm --workspace server test -- displays`
Expected: FAIL — `createDisplaysRepo` not found.

- [ ] **Step 3: Implement `server/src/store/displays.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export type Display = {
  id: string;
  name: string;
  lastSeen: string | null;
};

export type DisplaysRepo = {
  registerByName(name: string): Display;
  list(): Display[];
  touch(id: string): void;
  getByName(name: string): Display | null;
};

type Row = { id: string; name: string; last_seen: string | null };

function rowToDisplay(r: Row): Display {
  return { id: r.id, name: r.name, lastSeen: r.last_seen };
}

export function createDisplaysRepo(db: DB): DisplaysRepo {
  const selectByName = db.prepare<[string], Row>('SELECT id, name, last_seen FROM displays WHERE name = ?');
  const insert = db.prepare('INSERT INTO displays (id, name) VALUES (?, ?)');
  const selectAll = db.prepare<[], Row>('SELECT id, name, last_seen FROM displays ORDER BY name');
  const updateLastSeen = db.prepare('UPDATE displays SET last_seen = CURRENT_TIMESTAMP WHERE id = ?');

  return {
    registerByName(name) {
      const existing = selectByName.get(name);
      if (existing) return rowToDisplay(existing);
      const id = randomUUID();
      insert.run(id, name);
      return rowToDisplay(selectByName.get(name)!);
    },
    list() {
      return selectAll.all().map(rowToDisplay);
    },
    touch(id) {
      updateLastSeen.run(id);
    },
    getByName(name) {
      const r = selectByName.get(name);
      return r ? rowToDisplay(r) : null;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace server test -- displays`
Expected: PASS — all four assertions green.

- [ ] **Step 5: Commit**

```bash
git add server/src/store/displays.ts server/test/displays.test.ts
git commit -m "feat(server): add displays repository"
```

---

## Task 5: Settings repository

**Files:**
- Create: `server/src/store/settings.ts`
- Create: `server/test/settings.test.ts`

- [ ] **Step 1: Write the failing test `server/test/settings.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createSettingsRepo } from '../src/store/settings.js';

function freshRepo() {
  const db = new Database(':memory:');
  runMigrations(db);
  return createSettingsRepo(db);
}

describe('settings repo', () => {
  let repo: ReturnType<typeof createSettingsRepo>;

  beforeEach(() => {
    repo = freshRepo();
  });

  it('get returns null when key is unset', () => {
    expect(repo.get('foo')).toBeNull();
  });

  it('set then get returns the stored value', () => {
    repo.set('greeting', 'hello');
    expect(repo.get('greeting')).toBe('hello');
  });

  it('set overwrites existing values', () => {
    repo.set('greeting', 'hi');
    repo.set('greeting', 'hey');
    expect(repo.get('greeting')).toBe('hey');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm --workspace server test -- settings`
Expected: FAIL — `createSettingsRepo` not found.

- [ ] **Step 3: Implement `server/src/store/settings.ts`**

```ts
import type { DB } from './db.js';

export type SettingsRepo = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

export function createSettingsRepo(db: DB): SettingsRepo {
  const select = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?');
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  return {
    get(key) {
      const row = select.get(key);
      return row ? row.value : null;
    },
    set(key, value) {
      upsert.run(key, value);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace server test -- settings`
Expected: PASS — all three assertions green.

- [ ] **Step 5: Commit**

```bash
git add server/src/store/settings.ts server/test/settings.test.ts
git commit -m "feat(server): add settings repository"
```

---

## Task 6: HTTP API for display registration

**Files:**
- Create: `server/src/api/http.ts`
- Create: `server/test/http.test.ts`

The Fastify app exposes:
- `POST /api/displays/register` `{name}` → `{id, name, lastSeen}`
- `GET /api/displays` → `Display[]`

- [ ] **Step 1: Write the failing test `server/test/http.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { buildHttpApp } from '../src/api/http.js';

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  return buildHttpApp({ displays, settings });
}

describe('HTTP API', () => {
  let app: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    app = await setup();
  });

  it('POST /api/displays/register creates a display', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/register',
      payload: { name: 'Living Room' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Living Room');
    expect(typeof body.id).toBe('string');
  });

  it('POST /api/displays/register is idempotent for the same name', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Kitchen' } });
    const b = await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'Kitchen' } });
    expect(a.json().id).toBe(b.json().id);
  });

  it('POST /api/displays/register rejects empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/displays/register',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/displays lists registered displays', async () => {
    await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'A' } });
    await app.inject({ method: 'POST', url: '/api/displays/register', payload: { name: 'B' } });
    const res = await app.inject({ method: 'GET', url: '/api/displays' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((d: { name: string }) => d.name).sort()).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm --workspace server test -- http`
Expected: FAIL — `buildHttpApp` not found.

- [ ] **Step 3: Implement `server/src/api/http.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { DisplaysRepo } from '../store/displays.js';
import type { SettingsRepo } from '../store/settings.js';

export type HttpDeps = {
  displays: DisplaysRepo;
  settings: SettingsRepo;
};

export async function buildHttpApp(deps: HttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.post<{ Body: { name?: unknown } }>('/api/displays/register', async (req, reply) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      return reply.code(400).send({ error: 'name is required' });
    }
    const display = deps.displays.registerByName(name);
    return display;
  });

  app.get('/api/displays', async () => deps.displays.list());

  return app;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace server test -- http`
Expected: PASS — all four assertions green.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/http.ts server/test/http.test.ts
git commit -m "feat(server): add HTTP API for display registration"
```

---

## Task 7: WebSocket hub

**Files:**
- Create: `server/src/api/ws.ts`
- Create: `server/test/ws.test.ts`

The hub:
- Accepts WebSocket connections at `/ws`.
- First message from client is `{type: 'hello', displayName: string}`.
- Server responds `{type: 'welcome', displayId, message}` where `message` is `Hello, <name>!`.
- On connect, calls `displays.touch(id)` on each `hello`.

- [ ] **Step 1: Write the failing test `server/test/ws.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { runMigrations } from '../src/store/migrations.js';
import { createDisplaysRepo } from '../src/store/displays.js';
import { createSettingsRepo } from '../src/store/settings.js';
import { buildHttpApp } from '../src/api/http.js';
import { attachWsHub } from '../src/api/ws.js';

async function startServer() {
  const db = new Database(':memory:');
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);
  const app = await buildHttpApp({ displays, settings });
  attachWsHub(app.server, { displays });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (typeof addr === 'string' || !addr) throw new Error('no address');
  return { app, port: addr.port, displays };
}

function recv(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
}

describe('WebSocket hub', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    ctx = await startServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('responds to hello with a welcome message containing the display name', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Living Room' }));
    const msg = JSON.parse(await recv(ws));
    expect(msg.type).toBe('welcome');
    expect(msg.message).toBe('Hello, Living Room!');
    expect(typeof msg.displayId).toBe('string');
    ws.close();
  });

  it('registers the display in the repo on hello', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ type: 'hello', displayName: 'Kitchen' }));
    await recv(ws);
    expect(ctx.displays.getByName('Kitchen')).not.toBeNull();
    ws.close();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm --workspace server test -- ws`
Expected: FAIL — `attachWsHub` not found.

- [ ] **Step 3: Implement `server/src/api/ws.ts`**

```ts
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { DisplaysRepo } from '../store/displays.js';

export type WsDeps = {
  displays: DisplaysRepo;
};

type ClientMessage = { type: 'hello'; displayName: string };

function isHello(value: unknown): value is ClientMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'hello' &&
    typeof (value as { displayName?: unknown }).displayName === 'string'
  );
}

export function attachWsHub(server: Server, deps: WsDeps): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'invalid json' }));
        return;
      }
      if (!isHello(parsed)) {
        socket.send(JSON.stringify({ type: 'error', error: 'unsupported message' }));
        return;
      }
      const name = parsed.displayName.trim();
      if (!name) {
        socket.send(JSON.stringify({ type: 'error', error: 'displayName required' }));
        return;
      }
      const display = deps.displays.registerByName(name);
      deps.displays.touch(display.id);
      socket.send(
        JSON.stringify({
          type: 'welcome',
          displayId: display.id,
          message: `Hello, ${display.name}!`,
        })
      );
    });
  });

  return wss;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace server test -- ws`
Expected: PASS — both assertions green.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/ws.ts server/test/ws.test.ts
git commit -m "feat(server): add WebSocket hub with hello/welcome handshake"
```

---

## Task 8: Server entrypoint wiring

**Files:**
- Modify: `server/src/index.ts`
- Create: `server/src/static.ts`

The entrypoint opens the DB, runs migrations, builds repos, builds the HTTP app, attaches the WS hub, registers static serving, and listens.

- [ ] **Step 1: Create `server/src/static.ts`**

```ts
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export async function registerStatic(app: FastifyInstance, dir: string): Promise<void> {
  const root = resolve(dir);
  if (!existsSync(root)) {
    app.log?.warn?.(`static dir ${root} does not exist; skipping static serving`);
    return;
  }
  await app.register(fastifyStatic, { root, prefix: '/' });
}
```

- [ ] **Step 2: Replace `server/src/index.ts`**

```ts
import { config } from './config.js';
import { openDatabase } from './store/db.js';
import { runMigrations } from './store/migrations.js';
import { createDisplaysRepo } from './store/displays.js';
import { createSettingsRepo } from './store/settings.js';
import { buildHttpApp } from './api/http.js';
import { attachWsHub } from './api/ws.js';
import { registerStatic } from './static.js';

async function main() {
  const db = openDatabase(config.dbPath);
  runMigrations(db);
  const displays = createDisplaysRepo(db);
  const settings = createSettingsRepo(db);

  const app = await buildHttpApp({ displays, settings });
  await registerStatic(app, config.staticDir);
  attachWsHub(app.server, { displays });

  await app.listen({ port: config.port, host: config.host });
  console.log(`cosmos server listening on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Build the server**

Run: `npm --workspace server run build`
Expected: exit code 0.

- [ ] **Step 4: Boot the server in dev mode and confirm it listens**

In one terminal: `npm --workspace server run dev`
In another terminal: `curl -s -X POST http://localhost:8099/api/displays/register -H 'content-type: application/json' -d '{"name":"Test"}'`
Expected output (JSON one line): `{"id":"<uuid>","name":"Test","lastSeen":null}`

Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/src/static.ts
git commit -m "feat(server): wire entrypoint with HTTP + WS + static serving"
```

---

## Task 9: SvelteKit display app scaffold

**Files:**
- Create: `display/package.json`
- Create: `display/svelte.config.js`
- Create: `display/vite.config.ts`
- Create: `display/tsconfig.json`
- Create: `display/src/app.html`
- Create: `display/src/app.d.ts`
- Create: `display/src/routes/+layout.svelte`
- Create: `display/src/routes/+page.svelte`
- Create: `display/static/favicon.png` (zero-byte placeholder)

- [ ] **Step 1: Create `display/package.json`**

```json
{
  "name": "@cosmos/display",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev --port 5173",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^3.0.2",
    "@sveltejs/kit": "^2.5.10",
    "@sveltejs/vite-plugin-svelte": "^3.1.0",
    "svelte": "^4.2.17",
    "svelte-check": "^3.7.1",
    "typescript": "^5.4.5",
    "vite": "^5.2.11"
  }
}
```

- [ ] **Step 2: Create `display/svelte.config.js`**

```js
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: true,
    }),
  },
};
```

- [ ] **Step 3: Create `display/vite.config.ts`**

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      '/api': 'http://localhost:8099',
      '/ws': { target: 'ws://localhost:8099', ws: true },
    },
  },
});
```

- [ ] **Step 4: Create `display/tsconfig.json`**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "Bundler"
  }
}
```

- [ ] **Step 5: Create `display/src/app.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <title>Cosmos</title>
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover" style="margin:0;background:#0a0a0a;color:#f5f5f5;font-family:system-ui,sans-serif">
    <div style="display:contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 6: Create `display/src/app.d.ts`**

```ts
declare global {
  namespace App {}
}
export {};
```

- [ ] **Step 7: Create `display/src/routes/+layout.svelte`**

```svelte
<script lang="ts">
  // Layout intentionally minimal in this plan.
</script>

<slot />
```

- [ ] **Step 8: Create placeholder `display/src/routes/+page.svelte`**

```svelte
<main style="display:grid;place-items:center;min-height:100vh">
  <h1>Cosmos</h1>
</main>
```

- [ ] **Step 9: Create empty favicon placeholder**

Run: `node -e "require('fs').writeFileSync('display/static/favicon.png', Buffer.alloc(0))"`
Expected: file exists with 0 bytes.

- [ ] **Step 10: Install and build the display app**

From repo root:
```bash
npm install
npm --workspace display run build
```
Expected: `display/build/index.html` exists.

- [ ] **Step 11: Commit**

```bash
git add display/package.json display/svelte.config.js display/vite.config.ts display/tsconfig.json display/src display/static package-lock.json
git commit -m "chore(display): scaffold SvelteKit app with adapter-static"
```

---

## Task 10: Display name onboarding (browser storage)

**Files:**
- Create: `display/src/lib/storage.ts`

A tiny module that reads/writes the display name in `localStorage` under the key `cosmos:displayName`. SSR-safe (no-op when `window` is undefined).

- [ ] **Step 1: Create `display/src/lib/storage.ts`**

```ts
const KEY = 'cosmos:displayName';

export function getDisplayName(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(KEY);
}

export function setDisplayName(name: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, name);
}

export function clearDisplayName(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY);
}
```

- [ ] **Step 2: Commit**

```bash
git add display/src/lib/storage.ts
git commit -m "feat(display): add localStorage helpers for display name"
```

---

## Task 11: WebSocket client + onboarding + greeting render

**Files:**
- Create: `display/src/lib/ws.ts`
- Modify: `display/src/routes/+page.svelte`

The page logic:
- On mount: read display name from storage. If absent, render an onboarding form. If present, open a WebSocket to `/ws`, send `hello`, render the welcome message.
- Disable transitions and styles for now beyond a simple centered text — the design language comes in later plans.

- [ ] **Step 1: Create `display/src/lib/ws.ts`**

```ts
export type WelcomeMessage = { type: 'welcome'; displayId: string; message: string };
export type ServerMessage = WelcomeMessage | { type: 'error'; error: string };

export function connect(displayName: string, onMessage: (msg: ServerMessage) => void): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/ws`;
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'hello', displayName }));
  });
  ws.addEventListener('message', (event) => {
    try {
      const parsed = JSON.parse(event.data) as ServerMessage;
      onMessage(parsed);
    } catch {
      onMessage({ type: 'error', error: 'invalid server message' });
    }
  });
  return ws;
}
```

- [ ] **Step 2: Replace `display/src/routes/+page.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getDisplayName, setDisplayName } from '$lib/storage';
  import { connect, type ServerMessage } from '$lib/ws';

  let name: string | null = null;
  let inputName = '';
  let greeting: string | null = null;
  let error: string | null = null;
  let socket: WebSocket | null = null;

  function handleMessage(msg: ServerMessage) {
    if (msg.type === 'welcome') {
      greeting = msg.message;
      error = null;
    } else {
      error = msg.error;
    }
  }

  function start(n: string) {
    name = n;
    socket = connect(n, handleMessage);
  }

  function submitOnboarding(e: Event) {
    e.preventDefault();
    const trimmed = inputName.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
    start(trimmed);
  }

  onMount(() => {
    const stored = getDisplayName();
    if (stored) start(stored);
  });

  onDestroy(() => {
    socket?.close();
  });
</script>

<main style="display:grid;place-items:center;min-height:100vh;text-align:center;padding:2rem">
  {#if !name}
    <form on:submit={submitOnboarding} style="display:grid;gap:1rem;max-width:24rem;width:100%">
      <h1 style="margin:0;font-weight:300">Name this display</h1>
      <input
        bind:value={inputName}
        placeholder="e.g. Living Room"
        autofocus
        style="font-size:1.25rem;padding:0.75rem;border-radius:0.5rem;border:1px solid #333;background:#111;color:inherit"
      />
      <button
        type="submit"
        style="font-size:1.1rem;padding:0.75rem;border-radius:0.5rem;border:none;background:#f5f5f5;color:#0a0a0a;cursor:pointer"
      >
        Continue
      </button>
    </form>
  {:else if error}
    <p style="color:#ff8a8a">Error: {error}</p>
  {:else if greeting}
    <h1 style="font-weight:300;font-size:3rem">{greeting}</h1>
  {:else}
    <p style="opacity:0.6">Connecting…</p>
  {/if}
</main>
```

- [ ] **Step 3: Build the display app**

Run: `npm --workspace display run build`
Expected: exit code 0; `display/build/index.html` regenerated.

- [ ] **Step 4: Commit**

```bash
git add display/src/lib/ws.ts display/src/routes/+page.svelte
git commit -m "feat(display): add onboarding and WebSocket greeting"
```

---

## Task 12: End-to-end smoke verification

This task does not write code; it manually proves the loop end-to-end and locks the result in.

- [ ] **Step 1: Build everything fresh**

Run from repo root:
```bash
rm -rf display/build server/dist data
npm run build
```
Expected: exit code 0.

- [ ] **Step 2: Start the production server**

`npm --workspace server start` runs with the server directory as its CWD, so the default `DB_PATH` resolves to `server/data/cosmos.db` and the default `STATIC_DIR` resolves to `display/build` relative to repo root. To keep the SQLite file at the repo root instead (matches the smoke test in step 6), set `DB_PATH` to an absolute path.

Bash:
```bash
DB_PATH="$(pwd)/data/cosmos.db" npm --workspace server start
```
PowerShell:
```powershell
$env:DB_PATH = "$PWD/data/cosmos.db"; npm --workspace server start
```
Expected: log line `cosmos server listening on http://0.0.0.0:8099`.

- [ ] **Step 3: Verify the display app is served**

In another terminal:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8099/
```
(PowerShell: `(Invoke-WebRequest http://localhost:8099/).StatusCode`)
Expected: `200`.

- [ ] **Step 4: Verify HTTP API works against the live server**

```bash
curl -s -X POST http://localhost:8099/api/displays/register \
  -H 'content-type: application/json' \
  -d '{"name":"Living Room"}'
```
Expected: `{"id":"<uuid>","name":"Living Room","lastSeen":null}`

```bash
curl -s http://localhost:8099/api/displays
```
Expected: array containing the Living Room entry.

- [ ] **Step 5: Verify WebSocket loop in a browser**

Open `http://localhost:8099/` in a browser. Enter `Living Room` in the onboarding form, submit. Confirm the page renders `Hello, Living Room!`.

Reload the page — confirm it skips onboarding and renders the greeting again (display name persisted in `localStorage`).

- [ ] **Step 6: Verify persistence across server restarts**

Stop the server (Ctrl+C). Start it again with the same `DB_PATH`. Re-run `curl -s http://localhost:8099/api/displays` and confirm `Living Room` is still there with a `lastSeen` timestamp populated.

- [ ] **Step 7: Run the full test suite one last time**

Run: `npm test`
Expected: all server tests pass.

- [ ] **Step 8: Commit anything that drifted (likely nothing)**

```bash
git status
# if anything is modified that should be tracked, commit it; otherwise no-op
```

---

## Done criteria

- `npm test` is green.
- A built tablet-side app loads from the server, persists its display name, and shows a server-pushed greeting.
- The SQLite file at `data/cosmos.db` survives a server restart and retains registered displays.
- All commits made; working tree clean.

The next plan (Plan 2: Scenes & widgets) builds on top of this loop — the WebSocket starts pushing scene state instead of a hello string, and the page replaces its centered greeting with a scene canvas.
