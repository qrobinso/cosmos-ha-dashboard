# Music Video Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pin a specific YouTube video to a song — or block a song from playing any video — from a new admin page driven by Now Playing and recent resolution history.

**Architecture:** A new durable `music_video_override` table is consulted by `createMusicVideoResolver` *before* it reads the disposable `music_video_cache`, so a pin shadows any stale or wrong automatic result. Saving a pin resolves the video through a new `VideoLookup.probe()` method, which validates it and populates the stream cache in one yt-dlp call so the pin is immediately playable. A new `/admin/musicvideo` page drives it all through five REST routes.

**Tech Stack:** Node 20 + TypeScript (ESM, `.js` import extensions), Fastify, better-sqlite3, vitest, SvelteKit (Svelte 4) + adapter-static.

**Spec:** `docs/superpowers/specs/2026-08-06-music-video-overrides-design.md`

## Global Constraints

- **ESM with `.js` import extensions.** `import { x } from './y.js'` even though the source file is `y.ts`. TypeScript is configured with `moduleResolution: "Bundler"`.
- **Repos are factories.** `createXRepo(db) → XRepo`, prepared statements held in the closure. No per-call SQL string construction.
- **Migrations are append-only.** The next version is **12**. Never edit an existing migration.
- **Tests use `:memory:` SQLite with real repo factories.** Never mock the DB.
- **TDD, strictly.** Write the failing test, run it and *observe the failure*, implement, observe pass, commit. A test that has never been seen to fail is not a test.
- **Conventional commits:** `feat|fix|chore|refactor|docs(scope): subject`. One commit per task.
- **`HttpDeps.overrides` is already taken** by the transition-overrides repo. The new dep is named **`musicVideoOverrides`**. Do not shadow the existing name.
- **Admin styling comes from theme CSS variables only.** Never hardcode a color. Use the `.cosmos-admin` shell, `eyebrow` + `h1` header pattern, `.card` surfaces, `.tag` pills, 44px touch targets, breakpoints at 600px and 720px.
- **Run the server suite with** `npm --workspace server test`. Filter with e.g. `npm --workspace server test -- musicvideo.override`.
- **Known pre-existing condition:** the full server suite intermittently exits 139 (SIGSEGV) on roughly two runs in three. This predates this work and is not caused by it. Judge your task by your own filtered test file passing; if the full suite segfaults, re-run it, and only investigate if it fails *deterministically* or reports an actual assertion failure.

---

### Task 1: Migration v12 + override repo

**Files:**
- Modify: `server/src/store/migrations.ts` (append after the `version: 11` entry, around line 189)
- Create: `server/src/musicvideo/overrides.ts`
- Test: `server/test/musicvideo.overrides.test.ts`

**Interfaces:**
- Consumes: `DB` from `server/src/store/db.js`.
- Produces:
  ```ts
  export type MusicVideoOverride = {
    trackKey: string;
    /** null = blocked ("never play"). */
    videoId: string | null;
    artist: string;
    title: string;
    createdAt: number;
  };
  export type MusicVideoOverrideRepo = {
    get(trackKey: string): MusicVideoOverride | null;
    list(): MusicVideoOverride[];          // newest first
    put(o: { trackKey: string; videoId: string | null; artist: string; title: string }): void;
    remove(trackKey: string): boolean;     // true if a row was deleted
  };
  export function createMusicVideoOverrideRepo(
    db: DB,
    opts?: { now?: () => number },
  ): MusicVideoOverrideRepo;
  ```

- [ ] **Step 1: Write the failing test**

Create `server/test/musicvideo.overrides.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createMusicVideoOverrideRepo } from '../src/musicvideo/overrides.js';
import type { DB } from '../src/store/db.js';

function freshDb(): DB {
  const db = new Database(':memory:') as unknown as DB;
  runMigrations(db);
  return db;
}

describe('music video override repo', () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it('returns null for an unknown track', () => {
    const repo = createMusicVideoOverrideRepo(db);
    expect(repo.get('solange|weary')).toBeNull();
  });

  it('round-trips a pin', () => {
    const repo = createMusicVideoOverrideRepo(db, { now: () => 1000 });
    repo.put({ trackKey: 'solange|weary', videoId: 'abc12345678', artist: 'Solange', title: 'Weary' });
    expect(repo.get('solange|weary')).toEqual({
      trackKey: 'solange|weary',
      videoId: 'abc12345678',
      artist: 'Solange',
      title: 'Weary',
      createdAt: 1000,
    });
  });

  it('round-trips a block as a present row with a null videoId', () => {
    const repo = createMusicVideoOverrideRepo(db, { now: () => 1000 });
    repo.put({ trackKey: 'solange|weary', videoId: null, artist: 'Solange', title: 'Weary' });
    const got = repo.get('solange|weary');
    // Distinguishable from "no row" — that is the whole point of blocking.
    expect(got).not.toBeNull();
    expect(got!.videoId).toBeNull();
  });

  it('upserts on the same track key rather than erroring', () => {
    const repo = createMusicVideoOverrideRepo(db, { now: () => 1000 });
    repo.put({ trackKey: 'a|b', videoId: 'one11111111', artist: 'A', title: 'B' });
    repo.put({ trackKey: 'a|b', videoId: 'two22222222', artist: 'A', title: 'B' });
    expect(repo.get('a|b')!.videoId).toBe('two22222222');
    expect(repo.list()).toHaveLength(1);
  });

  it('lists newest first', () => {
    let t = 0;
    const repo = createMusicVideoOverrideRepo(db, { now: () => t });
    t = 100;
    repo.put({ trackKey: 'old|one', videoId: 'aaa11111111', artist: 'Old', title: 'One' });
    t = 200;
    repo.put({ trackKey: 'new|two', videoId: 'bbb22222222', artist: 'New', title: 'Two' });
    expect(repo.list().map((o) => o.trackKey)).toEqual(['new|two', 'old|one']);
  });

  it('removes, reporting whether a row went', () => {
    const repo = createMusicVideoOverrideRepo(db);
    repo.put({ trackKey: 'a|b', videoId: 'one11111111', artist: 'A', title: 'B' });
    expect(repo.remove('a|b')).toBe(true);
    expect(repo.get('a|b')).toBeNull();
    expect(repo.remove('a|b')).toBe(false);
  });

  it('migration v12 adds artist/title display columns to the cache table', () => {
    const cols = (db.prepare('PRAGMA table_info(music_video_cache)').all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).toContain('artist');
    expect(cols).toContain('title');
  });

  it('applies cleanly over a v11 database that already has cache rows', () => {
    // Simulate an existing install: build a v11 DB, put a row in, then migrate.
    const legacy = new Database(':memory:') as unknown as DB;
    legacy.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    legacy.exec(`CREATE TABLE music_video_cache (
      track_key TEXT PRIMARY KEY, video_id TEXT, miss INTEGER NOT NULL DEFAULT 0, resolved_at INTEGER NOT NULL);`);
    legacy.prepare('INSERT INTO music_video_cache (track_key, video_id, miss, resolved_at) VALUES (?,?,?,?)')
      .run('legacy|track', 'zzz99999999', 0, 5);
    for (let v = 1; v <= 11; v++) legacy.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v);

    runMigrations(legacy);

    const row = legacy.prepare('SELECT * FROM music_video_cache WHERE track_key = ?').get('legacy|track') as Record<string, unknown>;
    expect(row.video_id).toBe('zzz99999999');
    // Pre-v12 rows have no display names; the History list falls back to the key.
    expect(row.artist).toBeNull();
    expect(row.title).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server test -- musicvideo.overrides`
Expected: FAIL — cannot resolve `../src/musicvideo/overrides.js`.

- [ ] **Step 3: Append migration v12**

In `server/src/store/migrations.ts`, add a new entry to the migrations array immediately after the `version: 11` object (which ends around line 189, just before the closing `];`):

```ts
  {
    version: 12,
    up: `
      CREATE TABLE music_video_override (
        track_key  TEXT PRIMARY KEY,
        video_id   TEXT,
        artist     TEXT NOT NULL,
        title      TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      ALTER TABLE music_video_cache ADD COLUMN artist TEXT;
      ALTER TABLE music_video_cache ADD COLUMN title TEXT;
    `,
  },
```

Note `video_id` is deliberately nullable with no NOT NULL: a present row with a NULL
`video_id` is how "blocked" is stored, and it must stay distinguishable from no row at all.

- [ ] **Step 4: Write the repo**

Create `server/src/musicvideo/overrides.ts`:

```ts
import type { DB } from '../store/db.js';

/**
 * A user's manual decision about which video plays for a song, overriding
 * automatic resolution entirely.
 *
 * `videoId === null` means BLOCKED — never play anything for this track. That
 * is deliberately distinct from having no row at all, which is what an
 * expired negative cache entry decays to: a block is permanent, an unmatched
 * track gets retried after 24h.
 */
export type MusicVideoOverride = {
  trackKey: string;
  videoId: string | null;
  /** Display names as HA reported them. The cache key is lowercased and
   *  decoration-stripped, so it is unfit for the admin list. */
  artist: string;
  title: string;
  createdAt: number;
};

export type MusicVideoOverrideRepo = {
  get(trackKey: string): MusicVideoOverride | null;
  /** Newest first. */
  list(): MusicVideoOverride[];
  put(o: { trackKey: string; videoId: string | null; artist: string; title: string }): void;
  /** True when a row was actually deleted. */
  remove(trackKey: string): boolean;
};

type Row = {
  track_key: string;
  video_id: string | null;
  artist: string;
  title: string;
  created_at: number;
};

function toOverride(r: Row): MusicVideoOverride {
  return {
    trackKey: r.track_key,
    videoId: r.video_id,
    artist: r.artist,
    title: r.title,
    createdAt: r.created_at,
  };
}

/**
 * Durable, never pruned. This is user intent, not a cache — unlike
 * `music_video_cache`, which `prune()` caps at MAX_CACHE_ROWS and evicts
 * oldest-first. Keeping them in separate tables is what stops routine
 * maintenance from silently deleting a pin set months ago.
 */
export function createMusicVideoOverrideRepo(
  db: DB,
  opts: { now?: () => number } = {},
): MusicVideoOverrideRepo {
  const now = opts.now ?? (() => Date.now());

  const sel = db.prepare('SELECT * FROM music_video_override WHERE track_key = ?');
  const selAll = db.prepare('SELECT * FROM music_video_override ORDER BY created_at DESC');
  const upsert = db.prepare(`
    INSERT INTO music_video_override (track_key, video_id, artist, title, created_at)
    VALUES (@trackKey, @videoId, @artist, @title, @at)
    ON CONFLICT(track_key) DO UPDATE SET
      video_id   = excluded.video_id,
      artist     = excluded.artist,
      title      = excluded.title,
      created_at = excluded.created_at
  `);
  const del = db.prepare('DELETE FROM music_video_override WHERE track_key = ?');

  return {
    get(trackKey) {
      const row = sel.get(trackKey) as Row | undefined;
      return row ? toOverride(row) : null;
    },
    list() {
      return (selAll.all() as Row[]).map(toOverride);
    },
    put(o) {
      upsert.run({ ...o, at: now() });
    },
    remove(trackKey) {
      return del.run(trackKey).changes > 0;
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace server test -- musicvideo.overrides`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/store/migrations.ts server/src/musicvideo/overrides.ts server/test/musicvideo.overrides.test.ts
git commit -m "feat(musicvideo): migration v12 + durable override repo"
```

---

### Task 2: `parseYouTubeId`

**Files:**
- Create: `server/src/musicvideo/youtubeUrl.ts`
- Test: `server/test/musicvideo.youtubeUrl.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function parseYouTubeId(input: string): string | null`

- [ ] **Step 1: Write the failing test**

Create `server/test/musicvideo.youtubeUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseYouTubeId } from '../src/musicvideo/youtubeUrl.js';

describe('parseYouTubeId', () => {
  const ID = 'dQw4w9WgXcQ';

  it.each([
    ['plain watch URL', `https://www.youtube.com/watch?v=${ID}`],
    ['no www', `https://youtube.com/watch?v=${ID}`],
    ['http', `http://www.youtube.com/watch?v=${ID}`],
    ['protocol-relative', `//www.youtube.com/watch?v=${ID}`],
    ['no protocol', `www.youtube.com/watch?v=${ID}`],
    ['with timestamp', `https://www.youtube.com/watch?v=${ID}&t=42s`],
    ['with playlist', `https://www.youtube.com/watch?v=${ID}&list=PLabc&index=2`],
    ['v not first param', `https://www.youtube.com/watch?list=PLabc&v=${ID}`],
    ['short link', `https://youtu.be/${ID}`],
    ['short link with si', `https://youtu.be/${ID}?si=AbCdEf123`],
    ['short link with t', `https://youtu.be/${ID}?t=30`],
    ['youtube music', `https://music.youtube.com/watch?v=${ID}`],
    ['music with si', `https://music.youtube.com/watch?v=${ID}&si=xyz`],
    ['shorts', `https://www.youtube.com/shorts/${ID}`],
    ['shorts with query', `https://www.youtube.com/shorts/${ID}?feature=share`],
    ['embed', `https://www.youtube.com/embed/${ID}`],
    ['mobile', `https://m.youtube.com/watch?v=${ID}`],
    ['bare id', ID],
    ['surrounding whitespace', `  https://youtu.be/${ID}  `],
  ])('parses %s', (_label, input) => {
    expect(parseYouTubeId(input)).toBe(ID);
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['not a URL at all', 'hello world'],
    ['a different site', 'https://vimeo.com/12345678'],
    ['youtube homepage', 'https://www.youtube.com/'],
    ['channel page', 'https://www.youtube.com/@SomeArtist'],
    ['watch with no v param', 'https://www.youtube.com/watch?list=PLabc'],
    ['id too short', 'abc123'],
    ['id too long', 'dQw4w9WgXcQextra'],
    ['id with illegal chars', 'dQw4w9WgX!Q'],
  ])('rejects %s', (_label, input) => {
    expect(parseYouTubeId(input)).toBeNull();
  });

  it('does not mistake a lookalike host for youtube', () => {
    expect(parseYouTubeId(`https://notyoutube.com/watch?v=${ID}`)).toBeNull();
    expect(parseYouTubeId(`https://youtube.com.evil.example/watch?v=${ID}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server test -- musicvideo.youtubeUrl`
Expected: FAIL — cannot resolve `../src/musicvideo/youtubeUrl.js`.

- [ ] **Step 3: Implement**

Create `server/src/musicvideo/youtubeUrl.ts`:

```ts
/**
 * Extract a YouTube video id from whatever a user pastes.
 *
 * "Paste a share link" is this feature's entire input surface, and share links
 * are messy — YouTube alone emits at least five URL shapes, and the share
 * button decorates them with `si`, `t`, `list`, and `feature` params. Getting
 * this wrong means the override silently pins nothing.
 */

/** Exactly the YouTube id alphabet, exactly 11 characters. */
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Hosts we accept. Matched as a whole label, never as a substring —
 *  `youtube.com.evil.example` must not pass. */
const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/** Path prefixes that carry the id as the next segment. */
const PATH_PREFIXES = ['shorts', 'embed', 'v', 'live'];

export function parseYouTubeId(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  // A bare id, pasted straight from someone reading it off a URL.
  if (ID_RE.test(raw)) return raw;

  const url = toUrl(raw);
  if (!url) return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  // youtu.be/<id> — the whole path is the id.
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    return validId(url.pathname.split('/')[1]);
  }

  // /watch?v=<id>, wherever `v` sits among the params.
  const v = url.searchParams.get('v');
  if (v) return validId(v);

  // /shorts/<id>, /embed/<id>, /v/<id>, /live/<id>
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && PATH_PREFIXES.includes(segments[0].toLowerCase())) {
    return validId(segments[1]);
  }

  return null;
}

/**
 * Parse permissively. Users paste protocol-relative (`//youtu.be/…`) and
 * bare-host (`youtu.be/…`) forms constantly; `new URL` rejects both, so
 * supply a scheme when one is missing rather than failing the paste.
 */
function toUrl(raw: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw.replace(/^\/\//, '')}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function validId(candidate: string | undefined): string | null {
  if (!candidate) return null;
  return ID_RE.test(candidate) ? candidate : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace server test -- musicvideo.youtubeUrl`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add server/src/musicvideo/youtubeUrl.ts server/test/musicvideo.youtubeUrl.test.ts
git commit -m "feat(musicvideo): parse youtube share links into video ids"
```

---

### Task 3: `probe()` on `VideoLookup`

**Files:**
- Modify: `server/src/musicvideo/types.ts` (the `VideoLookup` interface, at the end of the file)
- Modify: `server/src/musicvideo/ytdlp.ts` (the returned object at the end of `createYtDlpLookup`, around lines 311–317)
- Test: `server/test/musicvideo.ytdlp.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `VideoSearchResult`, `ResolvedVideo` from `./types.js`; the module-private `invoke()` helper already in `ytdlp.ts`.
- Produces: `VideoLookup` gains `probe(videoId: string): Promise<VideoSearchResult>`.

**Why the union rather than a nullable:** the API in Task 6 needs to tell the user two
different things — "that video will not play, pick another" (`none`) versus "yt-dlp is not
available, try again shortly" (`unavailable`). A nullable return collapses both into one
unhelpful error. `VideoSearchResult` already draws exactly this distinction.

- [ ] **Step 1: Write the failing test**

Append to `server/test/musicvideo.ytdlp.test.ts`. Match the existing file's import list and
`createYtDlpLookup({ spawnFn })` fake-spawn style — read the top of that file first and
reuse its helpers rather than inventing new ones.

```ts
describe('probe', () => {
  const ID = 'dQw4w9WgXcQ';

  it('returns ok with title, duration and stream url for a playable video', async () => {
    const calls: string[][] = [];
    const lookup = createYtDlpLookup({
      spawnFn: async (args) => {
        calls.push(args);
        return {
          ok: true,
          stdout: JSON.stringify({
            id: ID,
            title: 'Some Artist - Some Song (Official Video)',
            duration: 213,
            url: 'https://rr1.googlevideo.com/videoplayback?stream',
          }),
        };
      },
    });

    const r = await lookup.probe(ID);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') throw new Error('unreachable');
    expect(r.video).toEqual({
      videoId: ID,
      title: 'Some Artist - Some Song (Official Video)',
      duration: 213,
      streamUrl: 'https://rr1.googlevideo.com/videoplayback?stream',
    });
    // Exactly one spawn — probe must not run a search.
    expect(calls).toHaveLength(1);
    expect(calls[0].join(' ')).toContain(`https://www.youtube.com/watch?v=${ID}`);
  });

  it('returns none for a video that cannot be resolved (private, removed, region-locked)', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: false, stdout: '' }),
    });
    expect((await lookup.probe(ID)).status).toBe('none');
  });

  it('returns unavailable when yt-dlp itself cannot be started', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: false, stdout: '', spawnFailed: true }),
    });
    // Distinct from `none`: the video may be perfectly fine, we just could not check.
    expect((await lookup.probe(ID)).status).toBe('unavailable');
  });
});
```

If the existing fake-spawn responses in that file use a different JSON field set, mirror
theirs — `invoke()` parses real yt-dlp output and the existing tests already encode its
exact shape. Adjust the fixture above to match rather than changing `invoke`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server test -- musicvideo.ytdlp`
Expected: FAIL — `lookup.probe is not a function`.

- [ ] **Step 3: Add `probe` to the interface**

In `server/src/musicvideo/types.ts`, inside `export interface VideoLookup`, after
`streamUrlFor`:

```ts
  /**
   * Resolve a KNOWN videoId to its full metadata + stream, without searching.
   *
   * Used by the manual-override admin flow to validate a pasted link before
   * saving it, and to populate the stream cache so the pin is immediately
   * playable. Returns the same three-state union as `search` because the
   * caller must distinguish "this video will not play" (`none`) from "we could
   * not check" (`unavailable`) — the user's next action differs.
   */
  probe(videoId: string): Promise<VideoSearchResult>;
```

- [ ] **Step 4: Implement in `ytdlp.ts`**

`invoke()` already returns a `VideoSearchResult` whose `ResolvedVideo` carries the title
and duration that `streamUrlFor` throws away. So `probe` is that call, unmodified.

Replace the returned object at the end of `createYtDlpLookup`:

```ts
  return {
    search,
    streamUrlFor: async (videoId) => {
      const r = await invoke(`https://www.youtube.com/watch?v=${videoId}`);
      return r.status === 'ok' ? r.video.streamUrl : null;
    },
    // Same single call as streamUrlFor, but keeping the metadata it discards.
    probe: (videoId) => invoke(`https://www.youtube.com/watch?v=${videoId}`),
  };
```

- [ ] **Step 5: Fix any other `VideoLookup` implementers**

Adding a method to the interface breaks every fake. Run:

```bash
npm --workspace server run build 2>&1 | head -40
```

Add a `probe` to each fake the compiler flags — in test files a
`probe: async () => ({ status: 'none' } as const)` stub is fine unless that test
exercises probing.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --workspace server test -- musicvideo`
Expected: PASS across all musicvideo test files.

- [ ] **Step 7: Commit**

```bash
git add server/src/musicvideo/types.ts server/src/musicvideo/ytdlp.ts server/test/
git commit -m "feat(musicvideo): add VideoLookup.probe for validating a known video id"
```

---

### Task 4: Cache display names + recent-history read

**Files:**
- Modify: `server/src/musicvideo/cache.ts`
- Test: `server/test/musicvideo.cache.test.ts` (append)

**Interfaces:**
- Consumes: migration v12's `artist`/`title` columns on `music_video_cache` (Task 1).
- Produces:
  ```ts
  // putVideoId gains an optional third argument — existing two-arg callers still compile.
  putVideoId(trackKey: string, videoId: string | null, names?: { artist?: string; title?: string }): void;

  export type CacheHistoryEntry = {
    trackKey: string;
    videoId: string | null;
    miss: boolean;
    /** Null for rows written before migration v12. */
    artist: string | null;
    title: string | null;
    resolvedAt: number;
  };
  listRecent(limit: number): CacheHistoryEntry[];   // newest first
  ```

- [ ] **Step 1: Write the failing test**

Append to `server/test/musicvideo.cache.test.ts`, reusing that file's existing DB setup helper:

```ts
describe('display names and history', () => {
  it('stores display names alongside a resolution', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('solange|weary', 'abc12345678', { artist: 'Solange', title: 'Weary' });

    const [entry] = cache.listRecent(10);
    expect(entry).toEqual({
      trackKey: 'solange|weary',
      videoId: 'abc12345678',
      miss: false,
      artist: 'Solange',
      title: 'Weary',
      resolvedAt: 1000,
    });
  });

  it('records negative results in history so they can be pinned', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('radiohead|karma police', null, { artist: 'Radiohead', title: 'Karma Police' });

    const [entry] = cache.listRecent(10);
    // This is the case the admin page exists to fix — it must be listed.
    expect(entry.miss).toBe(true);
    expect(entry.videoId).toBeNull();
    expect(entry.artist).toBe('Radiohead');
  });

  it('tolerates a call with no display names', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('a|b', 'abc12345678');
    const [entry] = cache.listRecent(10);
    expect(entry.artist).toBeNull();
    expect(entry.title).toBeNull();
  });

  it('lists newest first and honours the limit', () => {
    const db = freshDb();
    let t = 0;
    const cache = createMusicVideoCache(db, { now: () => t });
    t = 100; cache.putVideoId('a|one', 'aaa11111111');
    t = 200; cache.putVideoId('b|two', 'bbb22222222');
    t = 300; cache.putVideoId('c|three', 'ccc33333333');

    expect(cache.listRecent(2).map((e) => e.trackKey)).toEqual(['c|three', 'b|two']);
  });

  it('does not erase existing display names when re-resolved without them', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db, { now: () => 1000 });
    cache.putVideoId('a|b', 'aaa11111111', { artist: 'A', title: 'B' });
    cache.putVideoId('a|b', 'ccc33333333');
    const [entry] = cache.listRecent(10);
    expect(entry.artist).toBe('A');
    expect(entry.videoId).toBe('ccc33333333');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server test -- musicvideo.cache`
Expected: FAIL — `cache.listRecent is not a function`.

- [ ] **Step 3: Implement**

In `server/src/musicvideo/cache.ts`:

Add the type near `CachedStream`:

```ts
/** One row of the admin History list. */
export type CacheHistoryEntry = {
  trackKey: string;
  videoId: string | null;
  miss: boolean;
  /** Null for rows written before migration v12 — render the trackKey instead. */
  artist: string | null;
  title: string | null;
  resolvedAt: number;
};
```

Update the two `MusicVideoCache` members:

```ts
  /** Pass null to record a negative result. `names` are stored for the admin
   *  History list only — resolution itself keys entirely off `trackKey`. */
  putVideoId(
    trackKey: string,
    videoId: string | null,
    names?: { artist?: string; title?: string },
  ): void;
  /** Most recent resolutions, newest first. Drives the admin History list. */
  listRecent(limit: number): CacheHistoryEntry[];
```

Replace the `upsertLookup` statement so a re-resolve without names keeps the ones already
stored — `COALESCE(excluded.x, table.x)`:

```ts
  const upsertLookup = db.prepare(`
    INSERT INTO music_video_cache (track_key, video_id, miss, resolved_at, artist, title)
    VALUES (@key, @videoId, @miss, @at, @artist, @title)
    ON CONFLICT(track_key) DO UPDATE SET
      video_id    = excluded.video_id,
      miss        = excluded.miss,
      resolved_at = excluded.resolved_at,
      -- Keep names we already have when a re-resolve supplies none.
      artist      = COALESCE(excluded.artist, music_video_cache.artist),
      title       = COALESCE(excluded.title, music_video_cache.title)
  `);

  const selRecent = db.prepare(
    `SELECT track_key, video_id, miss, resolved_at, artist, title
       FROM music_video_cache ORDER BY resolved_at DESC LIMIT ?`,
  );
```

Update the `putVideoId` implementation and add `listRecent`:

```ts
    putVideoId(trackKey, videoId, names) {
      upsertLookup.run({
        key: trackKey,
        videoId,
        miss: videoId ? 0 : 1,
        at: now(),
        artist: names?.artist ?? null,
        title: names?.title ?? null,
      });
    },

    listRecent(limit) {
      const rows = selRecent.all(limit) as Array<{
        track_key: string;
        video_id: string | null;
        miss: number;
        resolved_at: number;
        artist: string | null;
        title: string | null;
      }>;
      return rows.map((r) => ({
        trackKey: r.track_key,
        videoId: r.video_id,
        miss: !!r.miss,
        artist: r.artist,
        title: r.title,
        resolvedAt: r.resolved_at,
      }));
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace server test -- musicvideo.cache`
Expected: PASS, including the pre-existing prune and TTL tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/musicvideo/cache.ts server/test/musicvideo.cache.test.ts
git commit -m "feat(musicvideo): record display names on cache rows + listRecent for history"
```

---

### Task 5: Resolver override precedence

**Files:**
- Modify: `server/src/musicvideo/resolver.ts`
- Test: `server/test/musicvideo.resolver.test.ts` (append)

**Interfaces:**
- Consumes: `MusicVideoOverrideRepo` (Task 1), `putVideoId(..., names)` (Task 4).
- Produces: `createMusicVideoResolver` gains a fourth argument slot — the overrides repo
  moves into `opts`:
  ```ts
  createMusicVideoResolver(
    lookup: VideoLookup,
    cache: MusicVideoCache,
    onUpdate: (widgetId: string) => void,
    opts?: { now?: () => number; overrides?: MusicVideoOverrideRepo },
  ): MusicVideoResolver
  ```
  Putting it in the existing optional `opts` bag means every current call site and test
  keeps compiling unchanged.

- [ ] **Step 1: Write the failing test**

Append to `server/test/musicvideo.resolver.test.ts`. Reuse that file's existing fake-lookup
helper and `:memory:` DB setup — read the top of the file first.

```ts
describe('manual overrides', () => {
  it('a pin beats a conflicting cache row, without spawning a lookup', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const overrides = createMusicVideoOverrideRepo(db);
    let searches = 0;
    const lookup = fakeLookup({ onSearch: () => { searches++; } });

    cache.putVideoId('solange|weary', 'wrongidxxxx');
    overrides.put({ trackKey: 'solange|weary', videoId: 'right123456', artist: 'Solange', title: 'Weary' });

    const resolver = createMusicVideoResolver(lookup, cache, () => {}, { overrides });
    expect(resolver('w1', { artist: 'Solange', title: 'Weary' })).toEqual({ videoId: 'right123456' });
    expect(searches).toBe(0);
  });

  it('a block suppresses the lookup entirely', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const overrides = createMusicVideoOverrideRepo(db);
    let searches = 0;
    const lookup = fakeLookup({ onSearch: () => { searches++; } });

    overrides.put({ trackKey: 'solange|weary', videoId: null, artist: 'Solange', title: 'Weary' });

    const resolver = createMusicVideoResolver(lookup, cache, () => {}, { overrides });
    expect(resolver('w1', { artist: 'Solange', title: 'Weary' })).toEqual({ videoId: null });
    // Not merely "returned null" — it must not have gone looking.
    expect(searches).toBe(0);
    expect(resolver.inFlightCount()).toBe(0);
  });

  it('a block still suppresses after the negative-cache TTL would have expired', () => {
    const db = freshDb();
    let t = 0;
    const cache = createMusicVideoCache(db, { now: () => t });
    const overrides = createMusicVideoOverrideRepo(db, { now: () => t });
    let searches = 0;
    const lookup = fakeLookup({ onSearch: () => { searches++; } });

    overrides.put({ trackKey: 'a|b', videoId: null, artist: 'A', title: 'B' });
    const resolver = createMusicVideoResolver(lookup, cache, () => {}, { overrides, now: () => t });

    t = 25 * 60 * 60 * 1000; // past NEGATIVE_TTL_MS
    expect(resolver('w1', { artist: 'A', title: 'B' })).toEqual({ videoId: null });
    expect(searches).toBe(0);
  });

  it('falls through to the normal path when no override exists', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const overrides = createMusicVideoOverrideRepo(db);
    let searches = 0;
    const lookup = fakeLookup({ onSearch: () => { searches++; } });

    const resolver = createMusicVideoResolver(lookup, cache, () => {}, { overrides });
    expect(resolver('w1', { artist: 'A', title: 'B' })).toEqual({ videoId: null });
    expect(searches).toBe(1);
  });

  it('works with no overrides repo wired at all', () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const resolver = createMusicVideoResolver(fakeLookup({}), cache, () => {});
    expect(() => resolver('w1', { artist: 'A', title: 'B' })).not.toThrow();
  });

  it('passes display names through to the cache so history is readable', async () => {
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const lookup = fakeLookup({ result: { status: 'none' } });
    const resolver = createMusicVideoResolver(lookup, cache, () => {});

    resolver('w1', { artist: 'Radiohead', title: 'Karma Police' });
    await vi.waitFor(() => expect(cache.listRecent(10)).toHaveLength(1));
    expect(cache.listRecent(10)[0].artist).toBe('Radiohead');
  });
});
```

Adapt `fakeLookup`'s option names to whatever the existing helper in that file accepts; if
it has no `onSearch` hook, count calls with a local counter inside the fake you build.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server test -- musicvideo.resolver`
Expected: FAIL — the pin test returns `{videoId: 'wrongidxxxx'}` (the cache row) instead of the pin.

- [ ] **Step 3: Implement**

In `server/src/musicvideo/resolver.ts`:

Add the import:

```ts
import type { MusicVideoOverrideRepo } from './overrides.js';
```

Widen the options parameter:

```ts
export function createMusicVideoResolver(
  lookup: VideoLookup,
  cache: MusicVideoCache,
  onUpdate: (widgetId: string) => void,
  opts: { now?: () => number; overrides?: MusicVideoOverrideRepo } = {},
): MusicVideoResolver {
  const now = opts.now ?? (() => Date.now());
  const overrides = opts.overrides ?? null;
```

Insert the override check in the resolver function, immediately after the `trackKey` guard
and **before** `cache.getVideoId(trackKey)`:

```ts
    // A manual override outranks everything — cache, cooldowns, concurrency
    // caps, the lot. It is an explicit user decision, so nothing automatic
    // gets to second-guess it, and a stale or wrong cache row is simply
    // shadowed rather than needing deletion.
    const override = overrides?.get(trackKey);
    if (override) {
      mvLog(
        override.videoId
          ? `override pin  key="${trackKey}" videoId=${override.videoId}`
          : `override block key="${trackKey}" — widget stays hidden by user request`,
      );
      return { videoId: override.videoId };
    }
```

Thread display names into both `putVideoId` calls inside `startLookup`. Extend the
`startLookup` signature to carry them (it already receives `hint`, which holds
`artist`/`title`):

```ts
          cache.putVideoId(trackKey, videoId, { artist: hint.artist, title: hint.title });
```

and for the `'none'` branch:

```ts
          cache.putVideoId(trackKey, null, { artist: hint.artist, title: hint.title });
```

Negative results especially need names — those are precisely the rows the admin History
list exists to surface.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace server test -- musicvideo`
Expected: PASS across all musicvideo files.

- [ ] **Step 5: Commit**

```bash
git add server/src/musicvideo/resolver.ts server/test/musicvideo.resolver.test.ts
git commit -m "feat(musicvideo): consult manual overrides ahead of the cache"
```

---

### Task 6: API routes + server wiring

**Files:**
- Modify: `server/src/api/musicvideo.ts`
- Modify: `server/src/api/http.ts` (`HttpDeps`, around lines 69–110)
- Modify: `server/src/index.ts` (build the repo ~line 52; pass to resolver ~line 450; pass to HttpDeps ~line 275)
- Test: `server/test/musicvideo.api.test.ts` (append)

**Interfaces:**
- Consumes: `createMusicVideoOverrideRepo` (Task 1), `parseYouTubeId` (Task 2), `probe` (Task 3), `listRecent` (Task 4).
- Produces: five routes, and `HttpDeps.musicVideoOverrides` + `HttpDeps.onMusicVideoOverridesChanged`.

**Settings key:** `musicvideo.admin_entity` — the `media_player` the admin page watches,
stored via the existing `SettingsRepo` (`get(key)` / `set(key, value)`, plain strings).

- [ ] **Step 1: Write the failing test**

Append to `server/test/musicvideo.api.test.ts`, reusing its existing `buildHttpApp` harness
and `app.inject` style:

```ts
describe('override routes', () => {
  const PIN = 'dQw4w9WgXcQ';

  function harness(over: Partial<{ probeResult: VideoSearchResult }> = {}) {
    const db = freshDb();
    const cache = createMusicVideoCache(db);
    const musicVideoOverrides = createMusicVideoOverrideRepo(db);
    let dirtied = 0;
    const lookup = {
      search: async () => ({ status: 'none' } as const),
      streamUrlFor: async () => null,
      probe: async () =>
        over.probeResult ?? ({
          status: 'ok',
          video: { videoId: PIN, streamUrl: 'https://rr1.googlevideo.com/x', duration: 213, title: 'A Song (Official Video)' },
        } as const),
    };
    return { db, cache, musicVideoOverrides, lookup, dirtied: () => dirtied, onChanged: () => { dirtied++; } };
  }

  it('POST pins a video, returning the resolved title and duration', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides, onMusicVideoOverridesChanged: h.onChanged });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: 'Solange', title: 'Weary', url: `https://youtu.be/${PIN}?si=abc` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ trackKey: 'solange|weary', videoId: PIN, resolvedTitle: 'A Song (Official Video)', durationSec: 213 });
    expect(h.musicVideoOverrides.get('solange|weary')!.videoId).toBe(PIN);
    // The pin must be playable right away, without a second yt-dlp call.
    expect(h.cache.getStream(PIN)).toMatchObject({ streamUrl: 'https://rr1.googlevideo.com/x', duration: 213 });
    expect(h.dirtied()).toBe(1);
  });

  it('POST derives the track key server-side, so the client cannot disagree with the resolver', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      // Decoration that normalizeTrackKey strips.
      payload: { artist: 'Solange', title: 'Weary (feat. Nobody)', url: PIN },
    });
    expect(res.json().trackKey).toBe('solange|weary');
  });

  it('POST with block:true stores a block and never probes', async () => {
    const h = harness();
    let probed = 0;
    const lookup = { ...h.lookup, probe: async () => { probed++; return { status: 'none' } as const; } };
    const app = await buildHttpApp({ ...baseDeps({ ...h, lookup }), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: 'Solange', title: 'Weary', block: true },
    });
    expect(res.statusCode).toBe(200);
    expect(h.musicVideoOverrides.get('solange|weary')).toMatchObject({ videoId: null });
    expect(probed).toBe(0);
  });

  it('POST rejects an unparseable link without saving', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: 'A', title: 'B', url: 'https://vimeo.com/12345' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/youtube/i);
    expect(h.musicVideoOverrides.get('a|b')).toBeNull();
  });

  it('POST rejects an unplayable video without saving', async () => {
    const h = harness({ probeResult: { status: 'none' } });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: 'A', title: 'B', url: PIN },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/could not be played/i);
    expect(h.musicVideoOverrides.get('a|b')).toBeNull();
  });

  it('POST distinguishes yt-dlp being unavailable from a bad video', async () => {
    const h = harness({ probeResult: { status: 'unavailable' } });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: 'A', title: 'B', url: PIN },
    });
    expect(res.statusCode).toBe(400);
    // The user's next action differs: retry, don't hunt for another link.
    expect(res.json().error).toMatch(/yt-dlp|try again/i);
  });

  it('POST rejects a track with no usable artist/title', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({
      method: 'POST', url: '/api/musicvideo/overrides',
      payload: { artist: '', title: '', url: PIN },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET lists overrides newest first', async () => {
    const h = harness();
    h.musicVideoOverrides.put({ trackKey: 'a|b', videoId: PIN, artist: 'A', title: 'B' });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/overrides' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('DELETE removes an override and marks displays dirty', async () => {
    const h = harness();
    h.musicVideoOverrides.put({ trackKey: 'a|b', videoId: PIN, artist: 'A', title: 'B' });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides, onMusicVideoOverridesChanged: h.onChanged });
    const res = await app.inject({ method: 'DELETE', url: '/api/musicvideo/overrides/a%7Cb' });
    expect(res.statusCode).toBe(200);
    expect(h.musicVideoOverrides.get('a|b')).toBeNull();
    expect(h.dirtied()).toBe(1);
  });

  it('DELETE of an unknown key is a 404', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'DELETE', url: '/api/musicvideo/overrides/nope%7Cnope' });
    expect(res.statusCode).toBe(404);
  });

  it('GET history lists recent resolutions including misses', async () => {
    const h = harness();
    h.cache.putVideoId('radiohead|karma police', null, { artist: 'Radiohead', title: 'Karma Police' });
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/history' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ trackKey: 'radiohead|karma police', videoId: null, artist: 'Radiohead' });
  });

  it('GET now-playing reports the configured entity and its override state', async () => {
    const h = harness();
    h.musicVideoOverrides.put({ trackKey: 'solange|weary', videoId: PIN, artist: 'Solange', title: 'Weary' });
    const settings = createSettingsRepo(h.db);
    settings.set('musicvideo.admin_entity', 'media_player.kitchen');
    const haClient = fakeHaClientWith([
      { entity_id: 'media_player.kitchen', state: 'playing',
        attributes: { media_artist: 'Solange', media_title: 'Weary', media_duration: 213 } },
    ]);
    const app = await buildHttpApp({ ...baseDeps(h), settings, haClient, musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/now-playing' });
    expect(res.json()).toMatchObject({
      entityId: 'media_player.kitchen',
      artist: 'Solange',
      title: 'Weary',
      trackKey: 'solange|weary',
      status: 'pinned',
    });
  });

  it('GET now-playing reports an empty state when no entity is configured', async () => {
    const h = harness();
    const app = await buildHttpApp({ ...baseDeps(h), musicVideoOverrides: h.musicVideoOverrides });
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/now-playing' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ entityId: null, status: 'no-entity' });
  });
});
```

Adapt `baseDeps(...)`, `freshDb()` and the fake HA client to whatever helpers that test
file already provides — build small local ones only if none exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server test -- musicvideo.api`
Expected: FAIL — the override routes 404.

- [ ] **Step 3: Extend `MusicVideoRouteDeps` and add the routes**

In `server/src/api/musicvideo.ts`, extend the deps type:

```ts
export type MusicVideoRouteDeps = {
  cache: MusicVideoCache | null;
  lookup: VideoLookup | null;
  /** Manual pin/block store. Null when the feature is not wired (tests). */
  musicVideoOverrides?: MusicVideoOverrideRepo | null;
  settings?: SettingsRepo | null;
  haClient?: HaClient | null;
  /** Fired after any override mutation so the host can re-push displays. */
  onOverridesChanged?: () => void;
  /** Injected by tests. */
  fetchImpl?: typeof fetch;
};
```

with imports:

```ts
import type { MusicVideoOverrideRepo } from '../musicvideo/overrides.js';
import type { SettingsRepo } from '../store/settings.js';
import type { HaClient } from '../ha/types.js';
import { parseYouTubeId } from '../musicvideo/youtubeUrl.js';
import { normalizeTrackKey } from '../musicvideo/trackKey.js';
```

Add the settings key constant and the routes inside `registerMusicVideoRoutes`:

```ts
/** Settings key for the media_player the admin overrides page watches. */
export const ADMIN_ENTITY_SETTING = 'musicvideo.admin_entity';

const HISTORY_LIMIT = 50;
```

```ts
  app.get('/api/musicvideo/overrides', async () => deps.musicVideoOverrides?.list() ?? []);

  app.get('/api/musicvideo/history', async () => deps.cache?.listRecent(HISTORY_LIMIT) ?? []);

  app.post<{ Body: { artist?: unknown; title?: unknown; url?: unknown; block?: unknown } }>(
    '/api/musicvideo/overrides',
    async (req, reply) => {
      const overrides = deps.musicVideoOverrides;
      if (!overrides) return reply.code(503).send({ error: 'Music video overrides are not available.' });

      const artist = typeof req.body?.artist === 'string' ? req.body.artist.trim() : '';
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';

      // The client never computes a track key. Deriving it here is what
      // guarantees the admin page and the resolver can never disagree about
      // which song a pin applies to.
      const trackKey = normalizeTrackKey(artist, title);
      if (!trackKey) {
        return reply.code(400).send({ error: 'A non-empty artist and title are required.' });
      }

      if (req.body?.block === true) {
        // Nothing to validate — there is no video.
        overrides.put({ trackKey, videoId: null, artist, title });
        deps.onOverridesChanged?.();
        return { trackKey, videoId: null, artist, title, blocked: true };
      }

      const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
      const videoId = parseYouTubeId(rawUrl);
      if (!videoId) {
        return reply.code(400).send({
          error: 'That does not look like a YouTube link. Paste a youtube.com/watch, youtu.be, or music.youtube.com URL.',
        });
      }

      if (!deps.lookup) {
        return reply.code(400).send({ error: 'Video lookup is not configured, so the link cannot be checked. Try again once yt-dlp is available.' });
      }

      const probed = await deps.lookup.probe(videoId);
      if (probed.status === 'unavailable') {
        // Distinct from a bad video: the link may be perfectly fine. Say so,
        // or the user goes hunting for a replacement that will not help.
        return reply.code(400).send({ error: 'yt-dlp could not be run, so the link could not be checked. Try again in a few minutes.' });
      }
      if (probed.status !== 'ok') {
        return reply.code(400).send({ error: 'That video could not be played — it may be private, removed, age-restricted, or region-locked. Try a different link.' });
      }

      // Populating the stream cache here is what makes the pin playable on the
      // very next push instead of costing another yt-dlp call.
      deps.cache?.putStream(videoId, probed.video.streamUrl, probed.video.duration);
      overrides.put({ trackKey, videoId, artist, title });
      deps.onOverridesChanged?.();

      return {
        trackKey,
        videoId,
        artist,
        title,
        blocked: false,
        resolvedTitle: probed.video.title,
        durationSec: probed.video.duration,
      };
    },
  );

  app.delete<{ Params: { trackKey: string } }>(
    '/api/musicvideo/overrides/:trackKey',
    async (req, reply) => {
      const overrides = deps.musicVideoOverrides;
      if (!overrides) return reply.code(503).send({ error: 'Music video overrides are not available.' });
      if (!overrides.remove(req.params.trackKey)) {
        return reply.code(404).send({ error: 'No override for that track.' });
      }
      deps.onOverridesChanged?.();
      return { ok: true };
    },
  );

  app.get('/api/musicvideo/now-playing', async () => {
    const entityId = deps.settings?.get(ADMIN_ENTITY_SETTING) ?? null;
    if (!entityId) return { entityId: null, status: 'no-entity' as const };

    const entity = deps.haClient?.listEntities().find((e) => e.entity_id === entityId) ?? null;
    if (!entity) return { entityId, status: 'entity-missing' as const };

    const a = (entity.attributes ?? {}) as Record<string, unknown>;
    const artist = typeof a.media_artist === 'string' ? a.media_artist : '';
    const title = typeof a.media_title === 'string' ? a.media_title : '';
    const trackKey = normalizeTrackKey(artist, title);
    if (!trackKey) {
      return { entityId, state: entity.state, artist, title, trackKey: null, status: 'nothing-playing' as const };
    }

    const override = deps.musicVideoOverrides?.get(trackKey) ?? null;
    const cached = deps.cache?.getVideoId(trackKey) ?? null;

    // Precedence here MUST mirror the resolver's, or the page will describe a
    // state the wall display is not in.
    const status = override
      ? override.videoId
        ? ('pinned' as const)
        : ('blocked' as const)
      : cached?.videoId
        ? ('auto' as const)
        : cached
          ? ('nothing-found' as const)
          : ('unresolved' as const);

    return {
      entityId,
      state: entity.state,
      artist,
      title,
      trackKey,
      status,
      videoId: override ? override.videoId : (cached?.videoId ?? null),
    };
  });
```

- [ ] **Step 4: Wire `HttpDeps`**

In `server/src/api/http.ts`, add to `HttpDeps` (near the existing `musicVideoCache` /
`musicVideoLookup` entries around line 85). **Name it `musicVideoOverrides`** — plain
`overrides` is already the transition-overrides repo:

```ts
  musicVideoOverrides?: import('../musicvideo/overrides.js').MusicVideoOverrideRepo;
  /** Fired after any music-video override mutation, so the host can re-push. */
  onMusicVideoOverridesChanged?: () => void;
```

Then pass them through at the existing `registerMusicVideoRoutes(...)` call site, alongside
`settings` and `haClient` which `HttpDeps` already carries:

```ts
  registerMusicVideoRoutes(app, {
    cache: deps.musicVideoCache ?? null,
    lookup: deps.musicVideoLookup ?? null,
    musicVideoOverrides: deps.musicVideoOverrides ?? null,
    settings: deps.settings,
    haClient: deps.haClient ?? null,
    onOverridesChanged: deps.onMusicVideoOverridesChanged,
  });
```

Keep any existing arguments (such as `fetchImpl`) that the call site already passes.

- [ ] **Step 5: Wire `index.ts`**

Three edits:

1. Build the repo next to the cache (~line 52):

```ts
  const musicVideoOverrides = createMusicVideoOverrideRepo(db);
```
with `import { createMusicVideoOverrideRepo } from './musicvideo/overrides.js';`

2. Pass it to the resolver (~line 450), adding to the existing options object:

```ts
  const musicVideoResolver = createMusicVideoResolver(
    musicVideoLookup,
    musicVideoCache,
    (widgetId) => { /* existing callback, unchanged */ },
    { overrides: musicVideoOverrides },
  );
```
If the existing call passes no options object, add one. If it already passes one, add the
`overrides` key to it.

3. Pass to `HttpDeps` (~line 275, beside `musicVideoCache`):

```ts
    musicVideoOverrides,
    onMusicVideoOverridesChanged: () => {
      // An override changes what plays for a song globally, and the API layer
      // has no widget ids to narrow this with. Displays are few and this fires
      // only on an explicit admin action, so a blanket re-push is the right
      // trade against threading widget ids through the route.
      for (const d of displaysRepo.list()) markDisplayDirty(d.id);
    },
```
Use whatever the local variable for the displays repo is actually called at that point in
`index.ts` — check before writing.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --workspace server test -- musicvideo.api`
Expected: PASS.

Then confirm the whole thing still compiles: `npm --workspace server run build`

- [ ] **Step 7: Commit**

```bash
git add server/src/api/musicvideo.ts server/src/api/http.ts server/src/index.ts server/test/musicvideo.api.test.ts
git commit -m "feat(musicvideo): REST routes for pinning, blocking, history and now-playing"
```

---

### Task 7: Admin page

**Files:**
- Create: `display/src/routes/admin/musicvideo/+page.svelte`
- Modify: `display/src/routes/admin/+layout.svelte` (the `links` array, lines 5–13)

**Interfaces:**
- Consumes: the five routes from Task 6, plus `GET /api/ha/entities?domain=media_player`
  (already exists) and `GET/PUT` of the `musicvideo.admin_entity` setting.

**Note on the setting:** Task 6 reads it via `SettingsRepo`, but there is no generic
settings REST endpoint. Add two tiny routes in `api/musicvideo.ts` alongside the others so
the page can read and write it:

```ts
  app.get('/api/musicvideo/settings', async () => ({
    entityId: deps.settings?.get(ADMIN_ENTITY_SETTING) ?? null,
  }));

  app.put<{ Body: { entityId?: unknown } }>('/api/musicvideo/settings', async (req, reply) => {
    const entityId = typeof req.body?.entityId === 'string' ? req.body.entityId.trim() : '';
    if (entityId && !entityId.startsWith('media_player.')) {
      return reply.code(400).send({ error: 'Expected a media_player entity.' });
    }
    deps.settings?.set(ADMIN_ENTITY_SETTING, entityId);
    return { entityId: entityId || null };
  });
```

- [ ] **Step 1: Add the nav entry**

In `display/src/routes/admin/+layout.svelte`, add to the `links` array between Displays and
Docs:

```ts
    { href: '/admin/musicvideo', label: 'Music Video' },
```

- [ ] **Step 2: Build the page**

Create `display/src/routes/admin/musicvideo/+page.svelte`. Read an existing admin page
first — `display/src/routes/admin/displays/+page.svelte` is the closest model — and match
its data-loading idiom (`onMount` + `fetch`), its markup conventions, and its `<style>`
approach exactly. Do not introduce a new pattern.

Structure, top to bottom:

```
<div class="page">
  <header>
    <p class="eyebrow">Music video</p>
    <h1>Overrides</h1>
    <p class="sub">Pin a specific YouTube video to a song, or stop one playing entirely.</p>
  </header>

  <!-- 1. Entity picker -->
  <section class="card">
    <h2>Watched player</h2>
    <select bind:value={entityId} on:change={saveEntity}>
      <option value="">Select a media player…</option>
      {#each mediaPlayers as p}
        <option value={p.entity_id}>{p.attributes?.friendly_name ?? p.entity_id}</option>
      {/each}
    </select>
  </section>

  <!-- 2. Now playing -->
  <section class="card">
    <h2>Now playing</h2>
    {#if nowPlaying?.trackKey}
      <p class="track">{nowPlaying.artist} — {nowPlaying.title}</p>
      <span class="tag {nowPlaying.status}">{statusLabel(nowPlaying.status)}</span>
      <input bind:value={pasteUrl} placeholder="Paste a YouTube link" />
      <button on:click={() => savePin(nowPlaying)} disabled={saving}>Save</button>
      <button class="ghost" on:click={() => saveBlock(nowPlaying)}>Never play</button>
      {#if saveError}<p class="error">{saveError}</p>{/if}
      {#if saveOk}<p class="ok">Pinned "{saveOk.resolvedTitle}" ({fmtDuration(saveOk.durationSec)})</p>{/if}
    {:else}
      <p class="empty">Nothing playing right now. Use Recent below to fix a song you heard earlier.</p>
    {/if}
  </section>

  <!-- 3. Overrides table -->
  <!-- 4. Recent history table, each row with Pin / Block that prefills section 2 -->
</div>
```

Required behaviours:

- **Poll `GET /api/musicvideo/now-playing` every 5 seconds** while the page is mounted, and
  clear the interval in `onDestroy`. A leaked interval on a long-lived admin tab is exactly
  the kind of drift Cosmos's low-resource posture exists to avoid.
- **Status pill labels:** `pinned` → "Pinned", `blocked` → "Blocked", `auto` → "Auto-matched",
  `nothing-found` → "Nothing found", `unresolved` → "Looking…", `no-entity` → "No player selected",
  `entity-missing` → "Player unavailable", `nothing-playing` → "Nothing playing".
- **Save flow:** POST, then on success refresh the overrides list, the history list and
  now-playing, clear the paste field, and show the resolved title + duration. On a non-2xx,
  render `body.error` verbatim — Task 6's messages are already written for a human, so do
  not replace them with a generic string.
- **Disable Save while a request is in flight.** A probe takes 2–5 seconds and a
  double-click would run two.
- **Recent rows** whose `artist`/`title` are null (pre-v12 rows) render the `trackKey`
  instead, and their Pin button still works by splitting the key on `|`.
- **Prefill:** a Pin button on a Recent or Overrides row scrolls to and populates section 2's
  form for that song, rather than needing it to be playing.
- **Remove** on an Overrides row calls DELETE with `encodeURIComponent(trackKey)` — track
  keys contain a `|` and, via artist names, can contain `/`.

Styling: theme variables only. Stack single-column by default; go two-column at 720px.
Tables become stacked cards below 600px, matching how the displays page handles narrow
widths.

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: the SvelteKit build succeeds with no new errors.

- [ ] **Step 4: Verify by hand**

Run `npm run dev`, open `http://localhost:5173/admin/musicvideo`, and check:
- the nav shows "Music Video" and highlights when active
- the player dropdown lists `media_player.*` entities and persists across a reload
- pasting a valid link saves and echoes back the resolved title
- pasting `https://vimeo.com/1` shows the YouTube-link error and saves nothing
- "Never play" creates a Blocked row
- Remove restores the row to automatic
- the layout holds at 375px, 600px and 1200px wide

- [ ] **Step 5: Commit**

```bash
git add display/src/routes/admin/musicvideo/+page.svelte display/src/routes/admin/+layout.svelte server/src/api/musicvideo.ts
git commit -m "feat(admin): music video overrides page"
```

---

### Task 8: Documentation + addon release

**Files:**
- Modify: `CLAUDE.md` (the `musicvideo/` bullet and the REST highlights list)
- Modify: `server/CLAUDE.md` (layout list, debug flags section)
- Modify: `display/CLAUDE.md` (admin pages list)
- Modify: `addon/DOCS.md`, `addon/CHANGELOG.md`, `addon/config.yaml`
- Create: `docs/music-video-overrides.md`

- [ ] **Step 1: Update `CLAUDE.md`**

Extend the `musicvideo/` architecture bullet with a sentence noting `overrides.ts` (durable
pin/block store, consulted by `resolver.ts` ahead of the cache) and `youtubeUrl.ts`. Add to
the REST highlights list:

```
- `GET|POST /api/musicvideo/overrides`, `DELETE /api/musicvideo/overrides/:trackKey` — manual pin/block per song.
- `GET /api/musicvideo/history` — the last 50 automatic resolutions, including misses.
- `GET /api/musicvideo/now-playing` — what the watched media_player is playing and how it currently resolves.
- `GET|PUT /api/musicvideo/settings` — which media_player the overrides page watches.
```

Also add to the "Known tech debt" list:

```
- The music video overrides page polls `/api/musicvideo/now-playing` every 5s rather than
  riding the existing WS push. Fine for an admin tab that is open briefly; move it onto the
  socket if it ever becomes a page people leave open all day.
```

- [ ] **Step 2: Update `server/CLAUDE.md`**

Add `src/musicvideo/overrides.ts` and `src/musicvideo/youtubeUrl.ts` to the layout list.
Note in the `LOG_MUSICVIDEO` paragraph that it now also emits `override pin` / `override
block` lines, which are the first thing to check when a widget shows something unexpected —
an override outranks every automatic signal, so a forgotten pin looks exactly like a
scoring bug.

- [ ] **Step 3: Update `display/CLAUDE.md`**

Add `/admin/musicvideo` to the admin pages list.

- [ ] **Step 4: Write the user doc**

Create `docs/music-video-overrides.md` covering: what the page is for, why automatic
matching misses some songs (reference the deliberate accuracy-over-coverage trade), how to
pin a video, how to block one, and that a pin is permanent until removed. Keep it short and
task-focused — this is user-facing, not architecture.

- [ ] **Step 5: Bump the addon**

In `addon/config.yaml`, bump `version:` to `0.8.0` — a new user-visible feature. Add a
`0.8.0` section to `addon/CHANGELOG.md` describing the overrides page. Add a section to
`addon/DOCS.md` pointing users at it.

- [ ] **Step 6: Verify and commit**

```bash
npm --workspace server test
npm run build
git add -A
git commit -m "docs(musicvideo): document manual overrides + bump addon to 0.8.0"
```

---

## Self-Review Notes

**Spec coverage:** storage → Task 1; resolution precedence → Task 5; `probe` → Task 3;
`parseYouTubeId` → Task 2; API → Task 6; admin page → Task 7; error handling → Tasks 6 and 7;
testing → distributed across all tasks; documentation → Task 8. History display names, a
detail of the storage section, are Task 4.

**One refinement against the spec:** the spec's `probe` returned a nullable; the plan uses
`VideoSearchResult` instead, because the spec's own error-handling section requires
distinguishing "video unplayable" from "yt-dlp unavailable" and a nullable cannot carry
that. The spec has been updated to match.

**One addition not in the spec:** `GET|PUT /api/musicvideo/settings` (Task 7). The spec says
the watched entity is "one new key in the existing settings KV repo" but no REST endpoint
exists to reach it from the browser, so the page cannot work without these two routes.
