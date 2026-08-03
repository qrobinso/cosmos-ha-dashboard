# Music Video Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `musicvideo` widget kind that plays the matching YouTube music video, muted and position-synced, for whatever track the bound `media_player` entity is playing.

**Architecture:** A new `server/src/musicvideo/` module resolves `artist|title` → YouTube videoId via `yt-dlp`, caches both the durable videoId and the ephemeral stream URL in SQLite, and never blocks the scene-push path (cache miss returns `null` immediately, then fires `onUpdate` to trigger a re-push — the same lifecycle as `createCanvasResolver`). The kiosk plays the video from a Cosmos-hosted proxy route rather than a raw googlevideo URL.

**Tech Stack:** Node + TypeScript + Fastify + better-sqlite3 + vitest (server); SvelteKit (display); `yt-dlp` as an external binary.

**Source spec:** `docs/superpowers/specs/2026-08-02-music-video-widget-design.md`

## Global Constraints

- **TDD, always.** Write the failing test, run it, observe the failure, implement, observe the pass, commit. Every task below is already ordered this way.
- **`yt-dlp` must never execute during the test suite.** The `VideoLookup` interface is injected with a fake in every test. `ytdlp.ts` tests inject a fake spawn function.
- **`yt-dlp` format is pinned to `-f 18`** (progressive 360p MP4, muxed). Do not use `bestvideo` or `best` — higher formats are DASH-only fragments that will not play in a bare `<video>` tag.
- **Nothing in `musicvideo/` may throw.** Every failure path returns `null`.
- **The resolver must never block the scene push.** `buildSceneState` is awaited on the push path; a yt-dlp call takes 2–5s.
- **All yt-dlp knowledge lives in `ytdlp.ts` only.** No other file may import `node:child_process` or reference the binary name.
- TTL constants, exact values: stream URL staleness `4h`, negative cache `24h`, yt-dlp subprocess timeout `15s`.
- Conventional commits: `feat|fix|chore|refactor(scope): subject`. Scope is `musicvideo` for server work.
- Run the server suite with `npm test` from the repo root, or a single file with `npm --workspace server exec vitest run <file>`.

---

## File Structure

**Create (server):**
- `server/src/musicvideo/types.ts` — `MusicVideoConfig`, `ResolvedVideo`, `VideoLookup`. No logic.
- `server/src/musicvideo/trackKey.ts` — pure `normalizeTrackKey(artist, title)`. Split out from `cache.ts` (the spec folded it in) so the string-munging rules are testable and readable in isolation.
- `server/src/musicvideo/ytdlp.ts` — the only file that knows `yt-dlp` exists.
- `server/src/musicvideo/cache.ts` — SQLite-backed two-tier cache repo.
- `server/src/musicvideo/resolver.ts` — non-blocking resolver, mirrors `createCanvasResolver`.
- `server/src/api/musicvideo.ts` — the `/api/musicvideo/stream/:videoId` proxy route.

**Create (display):**
- `display/src/lib/widgets/MusicVideo.svelte` — the kiosk widget.
- `display/src/lib/admin/widgets/MusicVideoConfig.svelte` — the inspector config panel.

**Modify:**
- `server/src/store/migrations.ts` — add migration version 11.
- `server/src/store/scenes.ts:42` — add `'musicvideo'` to `WIDGET_KINDS`.
- `server/src/api/scenes.ts` — `validateWidget` treats `musicvideo` as entity-bearing.
- `server/src/scenes/types.ts` — add `MusicVideoData` to the `WidgetData` union.
- `server/src/scenes/assembler.ts` — `musicVideoResolver` in `DataResolvers`, `musicvideo` case in `dataFor`.
- `server/src/api/ws.ts` — thread `musicVideoResolver` through hub deps.
- `server/src/api/http.ts` — register the proxy route.
- `server/src/index.ts` — construct cache + lookup + resolver, wire `onUpdate` to `markDisplayDirty`, add to `gc`/`dispose`.
- `display/src/lib/types.ts` — mirror `MusicVideoData`.
- `display/src/lib/scene/SceneCanvas.svelte` — dispatch the new kind.
- `display/src/lib/admin/widgetKinds.ts` — kind metadata.
- `display/src/lib/admin/widgets/index.ts` — register the config panel.
- `CLAUDE.md` — architecture bullet, REST highlight, tech-debt entries.

---

## Task 1: Track key normalization

Pure string logic, no dependencies. Doing it first means every later task can rely on a stable key format.

**Files:**
- Create: `server/src/musicvideo/types.ts`
- Create: `server/src/musicvideo/trackKey.ts`
- Test: `server/test/musicvideo.trackKey.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeTrackKey(artist: string | undefined, title: string | undefined): string | null`
  - `type MusicVideoConfig = { entity_id: string; query_suffix?: string }`
  - `type ResolvedVideo = { videoId: string; streamUrl: string; duration: number; title: string }`
  - `interface VideoLookup { search(query: string): Promise<ResolvedVideo | null>; streamUrlFor(videoId: string): Promise<string | null> }`

- [ ] **Step 1: Write the failing test**

Create `server/test/musicvideo.trackKey.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeTrackKey } from '../src/musicvideo/trackKey.js';

describe('normalizeTrackKey', () => {
  it('lowercases and joins artist and title with a pipe', () => {
    expect(normalizeTrackKey('David Bowie', 'Heroes')).toBe('david bowie|heroes');
  });

  it('collapses runs of whitespace', () => {
    expect(normalizeTrackKey('  David   Bowie ', ' Heroes  ')).toBe('david bowie|heroes');
  });

  it('strips a parenthesised feat. clause', () => {
    expect(normalizeTrackKey('Drake', 'Money In The Grave (feat. Rick Ross)'))
      .toBe('drake|money in the grave');
  });

  it('strips a bare feat. clause', () => {
    expect(normalizeTrackKey('Drake', 'Money In The Grave feat. Rick Ross'))
      .toBe('drake|money in the grave');
  });

  it('accepts ft. and featuring as spellings', () => {
    expect(normalizeTrackKey('A', 'Song ft. B')).toBe('a|song');
    expect(normalizeTrackKey('A', 'Song featuring B')).toBe('a|song');
  });

  it('strips a trailing remaster suffix', () => {
    expect(normalizeTrackKey('The Beatles', 'Come Together - Remastered 2009'))
      .toBe('the beatles|come together');
  });

  it('strips a parenthesised remaster suffix', () => {
    expect(normalizeTrackKey('The Beatles', 'Come Together (Remastered)'))
      .toBe('the beatles|come together');
  });

  it('strips version suffixes', () => {
    expect(normalizeTrackKey('A', 'Song - 2011 Remaster')).toBe('a|song');
    expect(normalizeTrackKey('A', 'Song (Deluxe Edition)')).toBe('a|song');
  });

  it('leaves an ordinary hyphenated title alone', () => {
    expect(normalizeTrackKey('Jay-Z', 'Song - Two')).toBe('jay-z|song - two');
  });

  it('returns null when either half is missing or blank', () => {
    expect(normalizeTrackKey(undefined, 'Heroes')).toBeNull();
    expect(normalizeTrackKey('Bowie', undefined)).toBeNull();
    expect(normalizeTrackKey('   ', 'Heroes')).toBeNull();
    expect(normalizeTrackKey('Bowie', '  ')).toBeNull();
  });

  it('returns null when stripping empties the title', () => {
    expect(normalizeTrackKey('Bowie', '(Remastered)')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server exec vitest run test/musicvideo.trackKey.test.ts`
Expected: FAIL — cannot resolve `../src/musicvideo/trackKey.js`.

- [ ] **Step 3: Write the types**

Create `server/src/musicvideo/types.ts`:

```ts
/** Config stored on a `musicvideo` widget. */
export interface MusicVideoConfig {
  /** Required. The `media_player.*` entity this widget follows. */
  entity_id: string;
  /** Appended to the search query. Defaults to "official music video". */
  query_suffix?: string;
}

/** A successful lookup: the video plus a directly-playable stream URL. */
export interface ResolvedVideo {
  videoId: string;
  streamUrl: string;
  /** Seconds. 0 when yt-dlp did not report one. */
  duration: number;
  title: string;
}

/**
 * The seam that keeps yt-dlp swappable. `ytdlp.ts` is one implementation;
 * a YouTube Data API v3 client would be another, with no other file changing.
 *
 * Neither method ever throws — every failure resolves to null.
 */
export interface VideoLookup {
  /** Search for a video and resolve its stream in one call. */
  search(query: string): Promise<ResolvedVideo | null>;
  /** Re-derive a fresh stream URL for a known videoId. */
  streamUrlFor(videoId: string): Promise<string | null>;
}
```

- [ ] **Step 4: Write the normalizer**

Create `server/src/musicvideo/trackKey.ts`:

```ts
/**
 * Collapse an (artist, title) pair into a stable cache key.
 *
 * Streaming services decorate the same song a dozen ways — "(feat. X)",
 * "- Remastered 2009", "(Deluxe Edition)" — and each variant would otherwise
 * cost its own yt-dlp search. Stripping the decoration means the whole family
 * shares one cached videoId.
 */

/** `feat.` / `ft.` / `featuring`, bare or parenthesised, to end of segment. */
const FEAT = /\s*[([]?\s*\b(?:feat\.?|ft\.?|featuring)\b[^)\]]*[)\]]?\s*$/i;

/** Remaster / edition / version decoration, parenthesised or after a dash. */
const VERSION =
  /\s*(?:[-–—]\s*|[([])\s*(?:\d{4}\s+)?(?:re-?master(?:ed)?|remix|deluxe|mono|stereo|radio edit|single version|album version|expanded|anniversary)[^)\]]*[)\]]?\s*$/i;

function clean(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  // Loop: a title can carry both decorations, e.g. "Song (feat. X) - Remastered".
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(FEAT, '').replace(VERSION, '').trim();
    if (s === before) break;
  }
  return s.toLowerCase();
}

/**
 * Returns `"<artist>|<title>"`, or null when either half is missing, blank,
 * or reduced to nothing by stripping.
 */
export function normalizeTrackKey(
  artist: string | undefined,
  title: string | undefined,
): string | null {
  if (!artist || !title) return null;
  const a = clean(artist);
  const t = clean(title);
  if (!a || !t) return null;
  return `${a}|${t}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --workspace server exec vitest run test/musicvideo.trackKey.test.ts`
Expected: PASS, 11 tests.

If the "ordinary hyphenated title" case fails, the `VERSION` regex is over-matching — it must only fire on the known decoration words, never on a bare dash.

- [ ] **Step 6: Commit**

```bash
git add server/src/musicvideo/types.ts server/src/musicvideo/trackKey.ts server/test/musicvideo.trackKey.test.ts
git commit -m "feat(musicvideo): track key normalization and core types"
```

---

## Task 2: SQLite cache

**Files:**
- Modify: `server/src/store/migrations.ts` (append migration version 11)
- Create: `server/src/musicvideo/cache.ts`
- Test: `server/test/musicvideo.cache.test.ts`

**Interfaces:**
- Consumes: `DB` from `../store/db.js`.
- Produces:
  - `createMusicVideoCache(db: DB, opts?: { now?: () => number }): MusicVideoCache`
  - `type CachedLookup = { videoId: string | null; miss: boolean }`
  - `type CachedStream = { streamUrl: string; duration: number }`
  - `MusicVideoCache` methods:
    - `getVideoId(trackKey: string): CachedLookup | null`
    - `putVideoId(trackKey: string, videoId: string | null): void`
    - `getStream(videoId: string): CachedStream | null`
    - `putStream(videoId: string, streamUrl: string, duration: number): void`
    - `invalidateStream(videoId: string): void`
  - Exported constants `NEGATIVE_TTL_MS = 86_400_000`, `STREAM_TTL_MS = 14_400_000`.

**Semantics to hold onto:** `getVideoId` returns `null` for "nothing cached, go look it up" and `{videoId: null, miss: true}` for "we looked, there is no video, don't look again yet". Those are different states and the resolver in Task 4 branches on the difference. A negative row past its TTL reads as `null` (look again). A positive row **never expires**.

- [ ] **Step 1: Write the failing test**

Create `server/test/musicvideo.cache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import type { DB } from '../src/store/db.js';
import {
  createMusicVideoCache,
  NEGATIVE_TTL_MS,
  STREAM_TTL_MS,
} from '../src/musicvideo/cache.js';

describe('music video cache', () => {
  let db: DB;
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
    clock = 1_000_000;
  });

  it('returns null for an unknown track key', () => {
    const cache = createMusicVideoCache(db, { now });
    expect(cache.getVideoId('bowie|heroes')).toBeNull();
  });

  it('round-trips a positive videoId', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('bowie|heroes', 'abc123');
    expect(cache.getVideoId('bowie|heroes')).toEqual({ videoId: 'abc123', miss: false });
  });

  it('never expires a positive videoId', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('bowie|heroes', 'abc123');
    clock += NEGATIVE_TTL_MS * 365;
    expect(cache.getVideoId('bowie|heroes')).toEqual({ videoId: 'abc123', miss: false });
  });

  it('records a negative result distinctly from an absent one', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('obscure|track', null);
    expect(cache.getVideoId('obscure|track')).toEqual({ videoId: null, miss: true });
  });

  it('expires a negative result after the negative TTL', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('obscure|track', null);
    clock += NEGATIVE_TTL_MS + 1;
    expect(cache.getVideoId('obscure|track')).toBeNull();
  });

  it('lets a later positive result overwrite a negative one', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('obscure|track', null);
    cache.putVideoId('obscure|track', 'xyz789');
    expect(cache.getVideoId('obscure|track')).toEqual({ videoId: 'xyz789', miss: false });
  });

  it('round-trips a stream url', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putStream('abc123', 'https://rr1.googlevideo.com/x', 214);
    expect(cache.getStream('abc123')).toEqual({
      streamUrl: 'https://rr1.googlevideo.com/x',
      duration: 214,
    });
  });

  it('treats a stream url older than the stream TTL as absent', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putStream('abc123', 'https://rr1.googlevideo.com/x', 214);
    clock += STREAM_TTL_MS + 1;
    expect(cache.getStream('abc123')).toBeNull();
  });

  it('refreshes staleness when a stream url is re-put', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putStream('abc123', 'https://old', 214);
    clock += STREAM_TTL_MS - 1;
    cache.putStream('abc123', 'https://new', 214);
    clock += STREAM_TTL_MS - 1;
    expect(cache.getStream('abc123')).toEqual({ streamUrl: 'https://new', duration: 214 });
  });

  it('drops a stream url on invalidate', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putStream('abc123', 'https://rr1.googlevideo.com/x', 214);
    cache.invalidateStream('abc123');
    expect(cache.getStream('abc123')).toBeNull();
  });

  it('keeps the videoId mapping when its stream is invalidated', () => {
    const cache = createMusicVideoCache(db, { now });
    cache.putVideoId('bowie|heroes', 'abc123');
    cache.putStream('abc123', 'https://x', 1);
    cache.invalidateStream('abc123');
    expect(cache.getVideoId('bowie|heroes')).toEqual({ videoId: 'abc123', miss: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server exec vitest run test/musicvideo.cache.test.ts`
Expected: FAIL — cannot resolve `../src/musicvideo/cache.js`.

- [ ] **Step 3: Add the migration**

In `server/src/store/migrations.ts`, append a new entry to the `migrations` array, immediately after the `version: 10` entry and before the closing `];`:

```ts
  {
    version: 11,
    up: `
      CREATE TABLE music_video_cache (
        track_key   TEXT PRIMARY KEY,
        video_id    TEXT,
        miss        INTEGER NOT NULL DEFAULT 0,
        resolved_at INTEGER NOT NULL
      );
      CREATE TABLE music_video_stream (
        video_id    TEXT PRIMARY KEY,
        stream_url  TEXT NOT NULL,
        duration    INTEGER NOT NULL DEFAULT 0,
        resolved_at INTEGER NOT NULL
      );
    `,
  },
```

Note `resolved_at` is an INTEGER epoch-millis column, not the `TEXT ... CURRENT_TIMESTAMP` convention used by older tables — TTL math wants a number, and an injectable clock makes the TTLs testable without waiting real hours.

- [ ] **Step 4: Write the cache**

Create `server/src/musicvideo/cache.ts`:

```ts
import type { DB } from '../store/db.js';

/** A negative result is retried after a day — a video may get uploaded later. */
export const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * YouTube expires stream URLs at roughly 6h. We treat 4h as stale so a URL is
 * never handed to a display close to its true expiry — the 2h margin covers a
 * long song started just before the cutoff.
 */
export const STREAM_TTL_MS = 4 * 60 * 60 * 1000;

/** `null` videoId with `miss: true` means "looked, found nothing, don't retry yet". */
export type CachedLookup = { videoId: string | null; miss: boolean };
export type CachedStream = { streamUrl: string; duration: number };

export type MusicVideoCache = {
  /** null = nothing usable cached, go look it up. */
  getVideoId(trackKey: string): CachedLookup | null;
  /** Pass null to record a negative result. */
  putVideoId(trackKey: string, videoId: string | null): void;
  /** null = absent or stale; the caller should re-derive. */
  getStream(videoId: string): CachedStream | null;
  putStream(videoId: string, streamUrl: string, duration: number): void;
  invalidateStream(videoId: string): void;
};

export function createMusicVideoCache(
  db: DB,
  opts: { now?: () => number } = {},
): MusicVideoCache {
  const now = opts.now ?? (() => Date.now());

  const selLookup = db.prepare(
    'SELECT video_id, miss, resolved_at FROM music_video_cache WHERE track_key = ?',
  );
  const upsertLookup = db.prepare(`
    INSERT INTO music_video_cache (track_key, video_id, miss, resolved_at)
    VALUES (@key, @videoId, @miss, @at)
    ON CONFLICT(track_key) DO UPDATE SET
      video_id = excluded.video_id,
      miss = excluded.miss,
      resolved_at = excluded.resolved_at
  `);
  const selStream = db.prepare(
    'SELECT stream_url, duration, resolved_at FROM music_video_stream WHERE video_id = ?',
  );
  const upsertStream = db.prepare(`
    INSERT INTO music_video_stream (video_id, stream_url, duration, resolved_at)
    VALUES (@videoId, @url, @duration, @at)
    ON CONFLICT(video_id) DO UPDATE SET
      stream_url = excluded.stream_url,
      duration = excluded.duration,
      resolved_at = excluded.resolved_at
  `);
  const delStream = db.prepare('DELETE FROM music_video_stream WHERE video_id = ?');

  return {
    getVideoId(trackKey) {
      const row = selLookup.get(trackKey) as
        | { video_id: string | null; miss: number; resolved_at: number }
        | undefined;
      if (!row) return null;
      if (row.miss) {
        // Negative results age out; positive ones never do.
        if (now() - row.resolved_at > NEGATIVE_TTL_MS) return null;
        return { videoId: null, miss: true };
      }
      if (!row.video_id) return null;
      return { videoId: row.video_id, miss: false };
    },

    putVideoId(trackKey, videoId) {
      upsertLookup.run({
        key: trackKey,
        videoId,
        miss: videoId ? 0 : 1,
        at: now(),
      });
    },

    getStream(videoId) {
      const row = selStream.get(videoId) as
        | { stream_url: string; duration: number; resolved_at: number }
        | undefined;
      if (!row) return null;
      if (now() - row.resolved_at > STREAM_TTL_MS) return null;
      return { streamUrl: row.stream_url, duration: row.duration };
    },

    putStream(videoId, streamUrl, duration) {
      upsertStream.run({ videoId, url: streamUrl, duration, at: now() });
    },

    invalidateStream(videoId) {
      delStream.run(videoId);
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --workspace server exec vitest run test/musicvideo.cache.test.ts test/migrations.test.ts`
Expected: PASS. The migrations test must still pass — if it asserts a specific latest version number, update that assertion to 11 as part of this task.

- [ ] **Step 6: Commit**

```bash
git add server/src/store/migrations.ts server/src/musicvideo/cache.ts server/test/musicvideo.cache.test.ts
git commit -m "feat(musicvideo): two-tier sqlite cache for videoIds and stream urls"
```

---

## Task 3: yt-dlp lookup

**Files:**
- Create: `server/src/musicvideo/ytdlp.ts`
- Test: `server/test/musicvideo.ytdlp.test.ts`

**Interfaces:**
- Consumes: `VideoLookup`, `ResolvedVideo` from `./types.js`.
- Produces:
  - `createYtDlpLookup(opts?: YtDlpOptions): VideoLookup`
  - `type SpawnFn = (args: string[], timeoutMs: number) => Promise<{ ok: boolean; stdout: string }>`
  - `type YtDlpOptions = { binary?: string; timeoutMs?: number; spawnFn?: SpawnFn }`
  - `YTDLP_TIMEOUT_MS = 15_000`

**The spawn seam:** the real spawn lives in a default `SpawnFn` inside this file; tests inject a fake. That is what keeps `yt-dlp` out of the test suite. The default implementation is the one place that must kill the child on timeout.

- [ ] **Step 1: Write the failing test**

Create `server/test/musicvideo.ytdlp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createYtDlpLookup } from '../src/musicvideo/ytdlp.js';

/** Minimal shape of the `yt-dlp -j` JSON line we care about. */
function ytdlpJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'abc123',
    title: 'David Bowie - Heroes (Official Video)',
    url: 'https://rr1.googlevideo.com/videoplayback?x=1',
    duration: 214,
    ...over,
  });
}

describe('createYtDlpLookup', () => {
  it('parses a successful search into a ResolvedVideo', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: ytdlpJson() }),
    });
    expect(await lookup.search('david bowie heroes')).toEqual({
      videoId: 'abc123',
      streamUrl: 'https://rr1.googlevideo.com/videoplayback?x=1',
      duration: 214,
      title: 'David Bowie - Heroes (Official Video)',
    });
  });

  it('pins format 18 and uses ytsearch1 for searches', async () => {
    let captured: string[] = [];
    const lookup = createYtDlpLookup({
      spawnFn: async (args) => {
        captured = args;
        return { ok: true, stdout: ytdlpJson() };
      },
    });
    await lookup.search('david bowie heroes');
    expect(captured).toContain('-f');
    expect(captured).toContain('18');
    expect(captured).toContain('-j');
    expect(captured.some((a) => a.startsWith('ytsearch1:'))).toBe(true);
    expect(captured.some((a) => a.includes('david bowie heroes'))).toBe(true);
  });

  it('returns null on a non-zero exit', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: false, stdout: '' }),
    });
    expect(await lookup.search('nope')).toBeNull();
  });

  it('returns null on malformed json', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: 'not json at all' }),
    });
    expect(await lookup.search('nope')).toBeNull();
  });

  it('returns null on empty stdout (no search results)', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: '   \n' }),
    });
    expect(await lookup.search('nope')).toBeNull();
  });

  it('returns null when json is well-formed but missing id or url', async () => {
    const noId = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: ytdlpJson({ id: undefined }) }),
    });
    expect(await noId.search('x')).toBeNull();

    const noUrl = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: ytdlpJson({ url: undefined }) }),
    });
    expect(await noUrl.search('x')).toBeNull();
  });

  it('defaults duration to 0 when absent', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: ytdlpJson({ duration: undefined }) }),
    });
    expect((await lookup.search('x'))?.duration).toBe(0);
  });

  it('reads only the first line when yt-dlp emits several', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: `${ytdlpJson()}\n${ytdlpJson({ id: 'second' })}` }),
    });
    expect((await lookup.search('x'))?.videoId).toBe('abc123');
  });

  it('never throws when the spawn itself rejects', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => {
        throw new Error('ENOENT: yt-dlp not found');
      },
    });
    await expect(lookup.search('x')).resolves.toBeNull();
  });

  it('streamUrlFor targets the video by id, not a search', async () => {
    let captured: string[] = [];
    const lookup = createYtDlpLookup({
      spawnFn: async (args) => {
        captured = args;
        return { ok: true, stdout: ytdlpJson() };
      },
    });
    const url = await lookup.streamUrlFor('abc123');
    expect(url).toBe('https://rr1.googlevideo.com/videoplayback?x=1');
    expect(captured.some((a) => a.startsWith('ytsearch1:'))).toBe(false);
    expect(captured).toContain('https://www.youtube.com/watch?v=abc123');
  });

  it('streamUrlFor returns null on failure', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: false, stdout: '' }),
    });
    expect(await lookup.streamUrlFor('abc123')).toBeNull();
  });

  it('passes the configured timeout to the spawn function', async () => {
    let seen = 0;
    const lookup = createYtDlpLookup({
      timeoutMs: 1234,
      spawnFn: async (_args, timeoutMs) => {
        seen = timeoutMs;
        return { ok: true, stdout: ytdlpJson() };
      },
    });
    await lookup.search('x');
    expect(seen).toBe(1234);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server exec vitest run test/musicvideo.ytdlp.test.ts`
Expected: FAIL — cannot resolve `../src/musicvideo/ytdlp.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/musicvideo/ytdlp.ts`:

```ts
import { spawn } from 'node:child_process';
import type { ResolvedVideo, VideoLookup } from './types.js';

export const YTDLP_TIMEOUT_MS = 15_000;

/**
 * Progressive 360p MP4 with muxed audio. Deliberately NOT `best` — the
 * higher-resolution YouTube formats are DASH-only fragmented streams that
 * will not play in a bare <video> tag, and format 18 supports the byte-range
 * seeking the position-sync feature depends on.
 */
const FORMAT = '18';

export type SpawnFn = (
  args: string[],
  timeoutMs: number,
) => Promise<{ ok: boolean; stdout: string }>;

export type YtDlpOptions = {
  binary?: string;
  timeoutMs?: number;
  /** Injected by tests so yt-dlp never actually runs. */
  spawnFn?: SpawnFn;
};

/**
 * Run the binary, collecting stdout. Resolves `{ok:false}` on non-zero exit,
 * spawn error, or timeout — and on timeout it KILLS the child, otherwise a
 * wedged yt-dlp lingers until process exit.
 */
function defaultSpawn(binary: string): SpawnFn {
  return (args, timeoutMs) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean, stdout: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok, stdout });
      };

      const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout.on('data', (c: Buffer) => {
        stdout += c.toString('utf8');
      });
      child.on('error', () => finish(false, ''));
      child.on('close', (code) => finish(code === 0, stdout));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(false, '');
      }, timeoutMs);
    });
}

/** Pull the first JSON object out of `yt-dlp -j` output. Never throws. */
function parseFirstJson(stdout: string): Record<string, unknown> | null {
  const line = stdout.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toResolved(json: Record<string, unknown>): ResolvedVideo | null {
  const videoId = typeof json.id === 'string' ? json.id : '';
  const streamUrl = typeof json.url === 'string' ? json.url : '';
  if (!videoId || !streamUrl) return null;
  return {
    videoId,
    streamUrl,
    duration: typeof json.duration === 'number' && Number.isFinite(json.duration)
      ? json.duration
      : 0,
    title: typeof json.title === 'string' ? json.title : '',
  };
}

/**
 * The only file in the codebase that knows yt-dlp exists.
 *
 * NOTE: yt-dlp is against YouTube's Terms of Service and its extractors break
 * when YouTube changes. This was a deliberate, accepted tradeoff — see the
 * design spec. Everything else talks to the `VideoLookup` interface, so
 * swapping in a YouTube Data API client means writing one new file.
 */
export function createYtDlpLookup(opts: YtDlpOptions = {}): VideoLookup {
  const binary = opts.binary ?? 'yt-dlp';
  const timeoutMs = opts.timeoutMs ?? YTDLP_TIMEOUT_MS;
  const run = opts.spawnFn ?? defaultSpawn(binary);

  async function invoke(target: string): Promise<ResolvedVideo | null> {
    try {
      const { ok, stdout } = await run(
        ['-f', FORMAT, '-j', '--no-playlist', '--no-warnings', target],
        timeoutMs,
      );
      if (!ok) return null;
      const json = parseFirstJson(stdout);
      return json ? toResolved(json) : null;
    } catch {
      // Binary missing, spawn refused, anything at all — callers get null.
      return null;
    }
  }

  return {
    search: (query) => invoke(`ytsearch1:${query}`),
    streamUrlFor: async (videoId) => {
      const r = await invoke(`https://www.youtube.com/watch?v=${videoId}`);
      return r?.streamUrl ?? null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace server exec vitest run test/musicvideo.ytdlp.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/musicvideo/ytdlp.ts server/test/musicvideo.ytdlp.test.ts
git commit -m "feat(musicvideo): yt-dlp lookup behind an injectable spawn seam"
```

---

## Task 4: Non-blocking resolver

The most important task in the plan. `buildSceneState` is awaited on the scene-push path, so a resolver that awaits yt-dlp would stall every push by 2–5 seconds. The contract is: **return immediately, always.**

**Files:**
- Create: `server/src/musicvideo/resolver.ts`
- Test: `server/test/musicvideo.resolver.test.ts`

**Interfaces:**
- Consumes: `VideoLookup` (Task 1), `MusicVideoCache` (Task 2), `normalizeTrackKey` (Task 1).
- Produces:
  - `type TrackRef = { artist?: string; title?: string; querySuffix?: string }`
  - `type MusicVideoResolver = ((widgetId: string, track: TrackRef) => { videoId: string | null }) & { dispose(widgetId?: string): void; gc(liveWidgetIds: Iterable<string>): void; inFlightCount(): number }`
  - `createMusicVideoResolver(lookup: VideoLookup, cache: MusicVideoCache, onUpdate: (widgetId: string) => void): MusicVideoResolver`
  - `DEFAULT_QUERY_SUFFIX = 'official music video'`

**Note the signature is synchronous.** It returns `{videoId}`, not a Promise. The assembler `await`s it harmlessly either way, but a sync return makes "this never blocks" a property of the type rather than a promise someone might later add an await inside.

- [ ] **Step 1: Write the failing test**

Create `server/test/musicvideo.resolver.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDatabase, type DB } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createMusicVideoCache } from '../src/musicvideo/cache.js';
import { createMusicVideoResolver } from '../src/musicvideo/resolver.js';
import type { VideoLookup, ResolvedVideo } from '../src/musicvideo/types.js';

const HEROES: ResolvedVideo = {
  videoId: 'abc123',
  streamUrl: 'https://rr1.googlevideo.com/x',
  duration: 214,
  title: 'Heroes',
};

/** A lookup whose search resolution the test controls by hand. */
function deferredLookup() {
  let release: (v: ResolvedVideo | null) => void = () => {};
  const searches: string[] = [];
  const lookup: VideoLookup = {
    search: (q) => {
      searches.push(q);
      return new Promise((res) => {
        release = res;
      });
    },
    streamUrlFor: async () => null,
  };
  return { lookup, searches, release: (v: ResolvedVideo | null) => release(v) };
}

/** Let queued microtasks (the background lookup chain) run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createMusicVideoResolver', () => {
  let db: DB;
  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
  });

  it('returns null immediately on a cache miss without awaiting the lookup', async () => {
    const { lookup, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const onUpdate = vi.fn();
    const resolve = createMusicVideoResolver(lookup, cache, onUpdate);

    // Synchronous return — the lookup has NOT settled.
    expect(resolve('w1', { artist: 'David Bowie', title: 'Heroes' })).toEqual({ videoId: null });
    expect(onUpdate).not.toHaveBeenCalled();

    release(HEROES);
    await flush();
    expect(onUpdate).toHaveBeenCalledWith('w1');
  });

  it('serves the videoId synchronously once cached, without spawning a lookup', async () => {
    const { lookup, searches, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn());

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    release(HEROES);
    await flush();

    expect(resolve('w1', { artist: 'David Bowie', title: 'Heroes' })).toEqual({ videoId: 'abc123' });
    expect(searches).toHaveLength(1);
  });

  it('persists the stream url alongside the videoId', async () => {
    const { lookup, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn());

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    release(HEROES);
    await flush();

    expect(cache.getStream('abc123')).toEqual({
      streamUrl: 'https://rr1.googlevideo.com/x',
      duration: 214,
    });
  });

  it('shares one in-flight lookup across concurrent widgets on the same track', async () => {
    const { lookup, searches, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const onUpdate = vi.fn();
    const resolve = createMusicVideoResolver(lookup, cache, onUpdate);

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    resolve('w2', { artist: 'David Bowie', title: 'Heroes' });
    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    expect(searches).toHaveLength(1);
    expect(resolve.inFlightCount()).toBe(1);

    release(HEROES);
    await flush();

    // Both widgets get told, exactly once each.
    expect(onUpdate.mock.calls.map((c) => c[0]).sort()).toEqual(['w1', 'w2']);
    expect(resolve.inFlightCount()).toBe(0);
  });

  it('negative-caches a failed lookup and does not retry it', async () => {
    const { lookup, searches, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn());

    resolve('w1', { artist: 'Nobody', title: 'Nothing' });
    release(null);
    await flush();

    expect(resolve('w1', { artist: 'Nobody', title: 'Nothing' })).toEqual({ videoId: null });
    expect(searches).toHaveLength(1);
  });

  it('returns null and never searches when the track has no artist or title', () => {
    const { lookup, searches } = deferredLookup();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), vi.fn());

    expect(resolve('w1', {})).toEqual({ videoId: null });
    expect(resolve('w1', { artist: 'A' })).toEqual({ videoId: null });
    expect(resolve('w1', { title: 'T' })).toEqual({ videoId: null });
    expect(searches).toHaveLength(0);
  });

  it('appends the default query suffix', async () => {
    const { lookup, searches, release } = deferredLookup();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), vi.fn());
    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    release(HEROES);
    await flush();
    expect(searches[0]).toBe('David Bowie Heroes official music video');
  });

  it('honours a custom query suffix', async () => {
    const { lookup, searches, release } = deferredLookup();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), vi.fn());
    resolve('w1', { artist: 'David Bowie', title: 'Heroes', querySuffix: 'live 1977' });
    release(HEROES);
    await flush();
    expect(searches[0]).toBe('David Bowie Heroes live 1977');
  });

  it('does not notify a widget that was disposed mid-lookup', async () => {
    const { lookup, release } = deferredLookup();
    const onUpdate = vi.fn();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), onUpdate);

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    resolve.dispose('w1');
    release(HEROES);
    await flush();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('gc drops widgets no longer on any scene', async () => {
    const { lookup, release } = deferredLookup();
    const onUpdate = vi.fn();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), onUpdate);

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    resolve.gc(['w2', 'w3']);
    release(HEROES);
    await flush();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('still caches the result even when every waiter was disposed', async () => {
    const { lookup, searches, release } = deferredLookup();
    const cache = createMusicVideoCache(db);
    const resolve = createMusicVideoResolver(lookup, cache, vi.fn());

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    resolve.dispose('w1');
    release(HEROES);
    await flush();

    expect(cache.getVideoId('david bowie|heroes')).toEqual({ videoId: 'abc123', miss: false });
    expect(resolve('w2', { artist: 'David Bowie', title: 'Heroes' })).toEqual({ videoId: 'abc123' });
    expect(searches).toHaveLength(1);
  });

  it('treats decorated variants of the same song as one cache entry', async () => {
    const { lookup, searches, release } = deferredLookup();
    const resolve = createMusicVideoResolver(lookup, createMusicVideoCache(db), vi.fn());

    resolve('w1', { artist: 'David Bowie', title: 'Heroes' });
    release(HEROES);
    await flush();

    expect(resolve('w1', { artist: 'DAVID BOWIE', title: 'Heroes - Remastered 2017' }))
      .toEqual({ videoId: 'abc123' });
    expect(searches).toHaveLength(1);
  });

  it('never rejects when the lookup itself throws', async () => {
    const cache = createMusicVideoCache(db);
    const onUpdate = vi.fn();
    const lookup: VideoLookup = {
      search: async () => {
        throw new Error('boom');
      },
      streamUrlFor: async () => null,
    };
    const resolve = createMusicVideoResolver(lookup, cache, onUpdate);

    expect(() => resolve('w1', { artist: 'A', title: 'B' })).not.toThrow();
    await flush();
    expect(resolve.inFlightCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server exec vitest run test/musicvideo.resolver.test.ts`
Expected: FAIL — cannot resolve `../src/musicvideo/resolver.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/musicvideo/resolver.ts`:

```ts
import type { MusicVideoCache } from './cache.js';
import { normalizeTrackKey } from './trackKey.js';
import type { VideoLookup } from './types.js';

export const DEFAULT_QUERY_SUFFIX = 'official music video';

export type TrackRef = {
  artist?: string;
  title?: string;
  querySuffix?: string;
};

export type MusicVideoResolver = ((
  widgetId: string,
  track: TrackRef,
) => { videoId: string | null }) & {
  dispose(widgetId?: string): void;
  gc(liveWidgetIds: Iterable<string>): void;
  /** Test/diagnostic hook: number of lookups currently running. */
  inFlightCount(): number;
};

/**
 * Resolve a widget's current track to a YouTube videoId **without ever
 * blocking the caller**.
 *
 * `buildSceneState` is awaited on the scene-push path and a yt-dlp call takes
 * 2–5 seconds, so this function is deliberately synchronous: a cache hit
 * returns the id, and a miss returns `{videoId: null}` right away while the
 * lookup runs in the background. When that lookup lands, `onUpdate(widgetId)`
 * fires and the host marks the display dirty, producing a normal re-push with
 * the id filled in. The widget is simply hidden in between.
 *
 * Mirrors `createCanvasResolver`'s dispose/gc lifecycle.
 */
export function createMusicVideoResolver(
  lookup: VideoLookup,
  cache: MusicVideoCache,
  onUpdate: (widgetId: string) => void,
): MusicVideoResolver {
  /** trackKey → widgetIds awaiting that lookup. Dedupes concurrent searches. */
  const inFlight = new Map<string, Set<string>>();
  /** Widgets that have been disposed/gc'd and must not be notified. */
  const live = new Set<string>();

  function startLookup(trackKey: string, query: string): void {
    const waiters = new Set<string>();
    inFlight.set(trackKey, waiters);

    void (async () => {
      let videoId: string | null = null;
      try {
        const found = await lookup.search(query);
        if (found) {
          videoId = found.videoId;
          cache.putStream(found.videoId, found.streamUrl, found.duration);
        }
        // Cache the outcome either way — a null here is a negative result,
        // which stops us respawning yt-dlp for an unmatchable track.
        cache.putVideoId(trackKey, videoId);
      } catch {
        // A lookup that throws is a bug in the lookup, not a negative result:
        // don't poison the cache, just let the next push retry.
        videoId = null;
      } finally {
        inFlight.delete(trackKey);
      }

      if (!videoId) return;
      for (const widgetId of waiters) {
        if (live.has(widgetId)) onUpdate(widgetId);
      }
    })();
  }

  const resolver = (widgetId: string, track: TrackRef) => {
    live.add(widgetId);

    const trackKey = normalizeTrackKey(track.artist, track.title);
    if (!trackKey) return { videoId: null };

    const cached = cache.getVideoId(trackKey);
    if (cached) return { videoId: cached.videoId };

    const existing = inFlight.get(trackKey);
    if (existing) {
      existing.add(widgetId);
      return { videoId: null };
    }

    const suffix = track.querySuffix?.trim() || DEFAULT_QUERY_SUFFIX;
    startLookup(trackKey, `${track.artist} ${track.title} ${suffix}`);
    inFlight.get(trackKey)?.add(widgetId);
    return { videoId: null };
  };

  return Object.assign(resolver, {
    dispose(widgetId?: string) {
      if (widgetId === undefined) live.clear();
      else live.delete(widgetId);
    },
    gc(liveWidgetIds: Iterable<string>) {
      const keep = new Set(liveWidgetIds);
      for (const id of live) if (!keep.has(id)) live.delete(id);
    },
    inFlightCount: () => inFlight.size,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace server exec vitest run test/musicvideo.resolver.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/musicvideo/resolver.ts server/test/musicvideo.resolver.test.ts
git commit -m "feat(musicvideo): non-blocking resolver with shared in-flight lookups"
```

---

## Task 5: Widget kind and assembler wiring

**Files:**
- Modify: `server/src/store/scenes.ts:42-44`
- Modify: `server/src/scenes/types.ts` (add `MusicVideoData`, extend `WidgetData`)
- Modify: `server/src/api/scenes.ts` (`validateWidget`)
- Modify: `server/src/scenes/assembler.ts` (`DataResolvers`, `dataFor`)
- Test: `server/test/musicvideo.assembler.test.ts`

**Interfaces:**
- Consumes: `TrackRef`, `MusicVideoResolver` (Task 4).
- Produces:
  - `type MusicVideoData = { entity_id: string; video_id: string | null; state: MediaPlayerData['state']; position?: number; duration?: number }`
  - `DataResolvers.musicVideoResolver?: (widgetId: string, track: TrackRef) => { videoId: string | null }`

**Field naming:** `video_id` is snake_case to match every other field on the widget-data types (`album_art_url`, `entity_id`), even though the resolver's internal type uses `videoId`.

- [ ] **Step 1: Write the failing test**

Create `server/test/musicvideo.assembler.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildSceneState } from '../src/scenes/assembler.js';
import type { Scene } from '../src/store/scenes.js';
import type { EntityState } from '../src/scenes/types.js';
import type { MusicVideoData } from '../src/scenes/types.js';

const SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 };

function scene(config: Record<string, unknown>): Scene {
  return {
    id: 'scene-1',
    name: 'Test',
    widgets: [
      {
        id: 'w1',
        kind: 'musicvideo',
        position: { x: 0, y: 0, w: 4, h: 3 },
        config,
      },
    ],
  } as unknown as Scene;
}

function playingEntity(over: Partial<EntityState['attributes']> = {}): EntityState {
  return {
    entity_id: 'media_player.living_room',
    state: 'playing',
    attributes: {
      media_artist: 'David Bowie',
      media_title: 'Heroes',
      media_position: 42,
      media_duration: 214,
      ...over,
    },
  } as unknown as EntityState;
}

describe('assembler — musicvideo widget', () => {
  it('passes artist and title to the resolver and surfaces the videoId', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: 'abc123' }));
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      {
        resolveEntity: () => playingEntity(),
        musicVideoResolver,
      },
    );

    expect(musicVideoResolver).toHaveBeenCalledWith('w1', {
      artist: 'David Bowie',
      title: 'Heroes',
      querySuffix: undefined,
    });

    const data = state.widgets[0].data as MusicVideoData;
    expect(data.video_id).toBe('abc123');
    expect(data.entity_id).toBe('media_player.living_room');
    expect(data.state).toBe('playing');
    expect(data.position).toBe(42);
    expect(data.duration).toBe(214);
  });

  it('forwards a configured query_suffix', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: null }));
    await buildSceneState(
      scene({ entity_id: 'media_player.living_room', query_suffix: 'live 1977' }),
      SAFE_AREA,
      { resolveEntity: () => playingEntity(), musicVideoResolver },
    );
    expect(musicVideoResolver).toHaveBeenCalledWith('w1', {
      artist: 'David Bowie',
      title: 'Heroes',
      querySuffix: 'live 1977',
    });
  });

  it('yields a null video_id while the lookup is still pending', async () => {
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      { resolveEntity: () => playingEntity(), musicVideoResolver: () => ({ videoId: null }) },
    );
    expect((state.widgets[0].data as MusicVideoData).video_id).toBeNull();
  });

  it('does not call the resolver when the player is not playing', async () => {
    const musicVideoResolver = vi.fn(() => ({ videoId: 'abc123' }));
    const idle = { ...playingEntity(), state: 'idle' } as EntityState;
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      { resolveEntity: () => idle, musicVideoResolver },
    );
    expect(musicVideoResolver).not.toHaveBeenCalled();
    expect((state.widgets[0].data as MusicVideoData).video_id).toBeNull();
  });

  it('degrades to a null video_id when no resolver is wired', async () => {
    const state = await buildSceneState(
      scene({ entity_id: 'media_player.living_room' }),
      SAFE_AREA,
      { resolveEntity: () => playingEntity() },
    );
    const data = state.widgets[0].data as MusicVideoData;
    expect(data.video_id).toBeNull();
    expect(data.entity_id).toBe('media_player.living_room');
  });

  it('handles a missing entity_id without throwing', async () => {
    const state = await buildSceneState(scene({}), SAFE_AREA, {
      musicVideoResolver: () => ({ videoId: null }),
    });
    expect((state.widgets[0].data as MusicVideoData).video_id).toBeNull();
  });
});
```

Also extend `server/test/scenes.api.test.ts` — or whichever existing file covers `validateWidget`; locate it with `grep -rn "is not a known widget kind" server/test`. Add:

```ts
it('accepts a musicvideo widget with a valid entity_id', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/scenes',
    payload: {
      name: 'MV',
      widgets: [
        {
          kind: 'musicvideo',
          position: { x: 0, y: 0, w: 4, h: 3 },
          config: { entity_id: 'media_player.living_room' },
        },
      ],
    },
  });
  expect(res.statusCode).toBe(201);
});

it('rejects a musicvideo widget with no entity_id', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/scenes',
    payload: {
      name: 'MV',
      widgets: [{ kind: 'musicvideo', position: { x: 0, y: 0, w: 4, h: 3 }, config: {} }],
    },
  });
  expect(res.statusCode).toBe(400);
});
```

Match the surrounding file's existing setup/teardown and expected status codes rather than assuming 201/400 — adjust if the file's other cases differ.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace server exec vitest run test/musicvideo.assembler.test.ts`
Expected: FAIL — `'musicvideo'` is not assignable to `WidgetKind`.

- [ ] **Step 3: Register the kind**

In `server/src/store/scenes.ts`, extend the array at line 42:

```ts
export const WIDGET_KINDS = [
  'clock', 'weather', 'entity_tile', 'calendar', 'media_player', 'statistics', 'text', 'camera', 'canvas',
  'musicvideo',
] as const;
```

In `server/src/api/scenes.ts`, find the set of entity-bearing kinds that `validateWidget` checks `entity_id` against and add `'musicvideo'` to it. (Search for where `entity_id` is validated; the kinds are listed in a set or array near `validateWidget`.)

- [ ] **Step 4: Add the data type**

In `server/src/scenes/types.ts`, add after `MediaPlayerData`:

```ts
/** Music video widget — the resolved YouTube video for the current track. */
export type MusicVideoData = {
  entity_id: string;
  /** null while resolving, or when no video matched. The widget hides. */
  video_id: string | null;
  state: MediaPlayerData['state'];
  /** seconds — player position at push time, used to seek the video */
  position?: number;
  /** seconds */
  duration?: number;
};
```

And extend the union:

```ts
export type WidgetData =
  | ClockData
  | WeatherData
  | EntityTileData
  | CalendarData
  | MediaPlayerData
  | StatisticsData
  | CameraData
  | CanvasData
  | MusicVideoData;
```

- [ ] **Step 5: Wire the assembler**

In `server/src/scenes/assembler.ts`, add to the `DataResolvers` type (after `canvasExtras`):

```ts
  /** Resolve the current track to a YouTube videoId. Synchronous by design —
   *  a cache miss returns null immediately and re-pushes later. Without this
   *  resolver, musicvideo widgets render hidden. */
  musicVideoResolver?: (
    widgetId: string,
    track: { artist?: string; title?: string; querySuffix?: string },
  ) => { videoId: string | null };
```

Add the builder function near `mediaPlayerData`:

```ts
const MV_ACTIVE_STATES = new Set(['playing', 'paused', 'buffering']);

async function musicVideoData(
  widget: Widget,
  resolver: EntityResolver,
  deps: DataResolvers,
): Promise<MusicVideoData> {
  const cfg = widget.config as Record<string, unknown>;
  const entityId = readString(cfg, 'entity_id');
  const empty: MusicVideoData = { entity_id: entityId, video_id: null, state: 'unknown' };
  if (!entityId) return empty;

  const entity = await resolver(entityId);
  if (!entity) return empty;

  const a = entity.attributes as Record<string, unknown>;
  const state = entity.state as MusicVideoData['state'];
  const position = typeof a.media_position === 'number' ? a.media_position : undefined;
  const duration = typeof a.media_duration === 'number' ? a.media_duration : undefined;

  // Only look up a video for a player that actually has a track loaded.
  if (!MV_ACTIVE_STATES.has(entity.state) || !deps.musicVideoResolver) {
    return { entity_id: entityId, video_id: null, state, position, duration };
  }

  const suffix = readString(cfg, 'query_suffix');
  const { videoId } = deps.musicVideoResolver(widget.id, {
    artist: typeof a.media_artist === 'string' ? a.media_artist : undefined,
    title: typeof a.media_title === 'string' ? a.media_title : undefined,
    querySuffix: suffix || undefined,
  });

  return { entity_id: entityId, video_id: videoId, state, position, duration };
}
```

Add the dispatch case in `dataFor`, after the `canvas` case:

```ts
    case 'musicvideo':
      return await musicVideoData(widget, resolver, deps);
```

Import `MusicVideoData` alongside the other type imports at the top of the file.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the whole suite, including the existing `assembler.test.ts`. A non-exhaustive-switch TypeScript error means the `dataFor` case is missing.

- [ ] **Step 7: Commit**

```bash
git add server/src/store/scenes.ts server/src/scenes/types.ts server/src/scenes/assembler.ts server/src/api/scenes.ts server/test/
git commit -m "feat(musicvideo): register widget kind and assemble video data"
```

---

## Task 6: Stream proxy route

**Files:**
- Create: `server/src/api/musicvideo.ts`
- Modify: `server/src/api/http.ts` (import + register)
- Test: `server/test/musicvideo.api.test.ts`

**Interfaces:**
- Consumes: `MusicVideoCache` (Task 2), `VideoLookup` (Task 1).
- Produces: `registerMusicVideoRoutes(app: FastifyInstance, deps: MusicVideoRouteDeps): void`, where `MusicVideoRouteDeps = { cache: MusicVideoCache | null; lookup: VideoLookup | null; fetchImpl?: typeof fetch }`.

Model this on `server/src/api/ha-media-proxy.ts` — it already demonstrates the header-forwarding and `Readable.fromWeb` streaming pattern used here.

- [ ] **Step 1: Write the failing test**

Create `server/test/musicvideo.api.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDatabase, type DB } from '../src/store/db.js';
import { runMigrations } from '../src/store/migrations.js';
import { createMusicVideoCache, type MusicVideoCache } from '../src/musicvideo/cache.js';
import { registerMusicVideoRoutes } from '../src/api/musicvideo.js';
import type { VideoLookup } from '../src/musicvideo/types.js';

function okResponse(body = 'VIDEOBYTES', headers: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'video/mp4', 'content-length': String(body.length), ...headers },
  });
}

describe('GET /api/musicvideo/stream/:videoId', () => {
  let app: FastifyInstance;
  let db: DB;
  let cache: MusicVideoCache;
  let lookup: VideoLookup;
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    runMigrations(db);
    cache = createMusicVideoCache(db);
    lookup = { search: async () => null, streamUrlFor: vi.fn(async () => 'https://fresh/url') };
    fetchImpl = vi.fn(async () => okResponse());
    app = Fastify({ logger: false });
    registerMusicVideoRoutes(app, { cache, lookup, fetchImpl: fetchImpl as unknown as typeof fetch });
    await app.ready();
  });

  it('streams a cached video and forwards content-type', async () => {
    cache.putStream('abc123', 'https://rr1.googlevideo.com/x', 214);
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('video/mp4');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://rr1.googlevideo.com/x',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('forwards the Range header upstream and relays content-range', async () => {
    cache.putStream('abc123', 'https://rr1.googlevideo.com/x', 214);
    fetchImpl.mockResolvedValueOnce(
      new Response('PART', {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 100-103/1000',
          'content-length': '4',
          'accept-ranges': 'bytes',
        },
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/musicvideo/stream/abc123',
      headers: { range: 'bytes=100-103' },
    });

    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 100-103/1000');
    expect(res.headers['accept-ranges']).toBe('bytes');
    const init = fetchImpl.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Range).toBe('bytes=100-103');
  });

  it('re-derives a stale stream url before streaming', async () => {
    // Nothing cached at all — the route must ask the lookup.
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(200);
    expect(lookup.streamUrlFor).toHaveBeenCalledWith('abc123');
    expect(fetchImpl).toHaveBeenCalledWith('https://fresh/url', expect.anything());
    // And it persists the refreshed url.
    expect(cache.getStream('abc123')?.streamUrl).toBe('https://fresh/url');
  });

  it('404s when the video cannot be resolved', async () => {
    lookup = { search: async () => null, streamUrlFor: async () => null };
    const app2 = Fastify({ logger: false });
    registerMusicVideoRoutes(app2, { cache, lookup, fetchImpl: fetchImpl as unknown as typeof fetch });
    await app2.ready();
    const res = await app2.inject({ method: 'GET', url: '/api/musicvideo/stream/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('404s and invalidates the cached url when upstream rejects it', async () => {
    cache.putStream('abc123', 'https://expired/url', 214);
    fetchImpl.mockResolvedValueOnce(new Response('', { status: 403 }));
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(404);
    expect(cache.getStream('abc123')).toBeNull();
  });

  it('404s when the upstream fetch throws', async () => {
    cache.putStream('abc123', 'https://x', 214);
    fetchImpl.mockRejectedValueOnce(new Error('network down'));
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(404);
  });

  it('503s when no cache or lookup is configured', async () => {
    const bare = Fastify({ logger: false });
    registerMusicVideoRoutes(bare, { cache: null, lookup: null });
    await bare.ready();
    const res = await bare.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.statusCode).toBe(503);
  });

  it('rejects a videoId with unexpected characters', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/..%2Fetc' });
    expect(res.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never caches the response in the browser', async () => {
    cache.putStream('abc123', 'https://x', 214);
    const res = await app.inject({ method: 'GET', url: '/api/musicvideo/stream/abc123' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace server exec vitest run test/musicvideo.api.test.ts`
Expected: FAIL — cannot resolve `../src/api/musicvideo.js`.

- [ ] **Step 3: Write the route**

Create `server/src/api/musicvideo.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import type { MusicVideoCache } from '../musicvideo/cache.js';
import type { VideoLookup } from '../musicvideo/types.js';

/** YouTube ids are 11 chars of [A-Za-z0-9_-]; be strict, this reaches fetch(). */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

export type MusicVideoRouteDeps = {
  cache: MusicVideoCache | null;
  lookup: VideoLookup | null;
  /** Injected by tests. */
  fetchImpl?: typeof fetch;
};

/**
 * Proxies the YouTube progressive stream to the kiosk.
 *
 * The display never sees a googlevideo URL, because those expire in ~6h and
 * are frequently bound to the IP that resolved them — and the server resolving
 * them is not the machine playing them. Going through here means an expired
 * URL is silently re-derived server-side instead of leaving a dead <video>.
 */
export function registerMusicVideoRoutes(
  app: FastifyInstance,
  deps: MusicVideoRouteDeps,
): void {
  const doFetch = deps.fetchImpl ?? fetch;

  app.get<{ Params: { videoId: string } }>(
    '/api/musicvideo/stream/:videoId',
    async (req, reply) => {
      const { cache, lookup } = deps;
      if (!cache || !lookup) {
        return reply.code(503).send({ error: 'music video lookup not configured' });
      }

      const videoId = req.params.videoId;
      if (!VIDEO_ID_RE.test(videoId)) {
        return reply.code(400).send({ error: 'invalid videoId' });
      }

      // Cached URL, or re-derive when absent/stale.
      let streamUrl = cache.getStream(videoId)?.streamUrl ?? null;
      if (!streamUrl) {
        streamUrl = await lookup.streamUrlFor(videoId);
        if (!streamUrl) return reply.code(404).send({ error: 'video unavailable' });
        cache.putStream(videoId, streamUrl, 0);
      }

      try {
        const headers: Record<string, string> = {};
        const range = req.headers.range;
        if (typeof range === 'string') headers.Range = range;

        const upstream = await doFetch(streamUrl, { headers });
        if (!upstream.ok && upstream.status !== 206) {
          // Almost always an expired or IP-bound URL. Drop it so the next
          // request re-derives rather than serving the same dead link.
          cache.invalidateStream(videoId);
          return reply.code(404).send({ error: 'stream unavailable' });
        }

        for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
          const v = upstream.headers.get(h);
          if (v) reply.header(h, v);
        }
        reply.header('cache-control', 'no-store');
        reply.code(upstream.status);

        if (!upstream.body) return reply.send();

        const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
        // If the kiosk navigates away mid-song, tear down the upstream socket
        // instead of letting it drain bandwidth until process exit.
        req.raw.on('close', () => nodeStream.destroy());
        return reply.send(nodeStream);
      } catch {
        return reply.code(404).send({ error: 'stream unavailable' });
      }
    },
  );
}
```

- [ ] **Step 4: Register the route**

In `server/src/api/http.ts`, add the import beside the other route imports:

```ts
import { registerMusicVideoRoutes } from './musicvideo.js';
```

Add to the deps type for `buildServer` (beside `haClient`, `voiceClient`, etc.):

```ts
  musicVideoCache?: import('../musicvideo/cache.js').MusicVideoCache;
  musicVideoLookup?: import('../musicvideo/types.js').VideoLookup;
```

And register beside `registerMoodRoutes(...)` around line 273:

```ts
  registerMusicVideoRoutes(app, {
    cache: deps.musicVideoCache ?? null,
    lookup: deps.musicVideoLookup ?? null,
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, whole suite.

- [ ] **Step 6: Commit**

```bash
git add server/src/api/musicvideo.ts server/src/api/http.ts server/test/musicvideo.api.test.ts
git commit -m "feat(musicvideo): proxy youtube streams through the cosmos server"
```

---

## Task 7: Server wiring

Constructs the real objects and connects `onUpdate` to the existing dirty-display machinery. No new test file — the wiring is exercised by `npm run dev`; the unit behavior is already covered by Tasks 2–6.

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/src/api/ws.ts`

**Interfaces:**
- Consumes: `createMusicVideoCache`, `createYtDlpLookup`, `createMusicVideoResolver`, `registerMusicVideoRoutes`.
- Produces: nothing new.

- [ ] **Step 1: Thread the resolver through the WS hub**

In `server/src/api/ws.ts`, next to the existing `canvasResolver?` declaration at line 50:

```ts
  musicVideoResolver?: import('../scenes/assembler.js').DataResolvers['musicVideoResolver'];
```

And in the `DataResolvers` object built around line 193, beside `canvasResolver: deps.canvasResolver,`:

```ts
      musicVideoResolver: deps.musicVideoResolver,
```

- [ ] **Step 2: Construct and wire in index.ts**

In `server/src/index.ts`, add imports beside the `createCanvasResolver` import at line 21:

```ts
import { createMusicVideoCache } from './musicvideo/cache.js';
import { createYtDlpLookup } from './musicvideo/ytdlp.js';
import { createMusicVideoResolver } from './musicvideo/resolver.js';
```

Immediately after the `canvasResolver` block (which ends around line 412), add:

```ts
  const musicVideoCache = createMusicVideoCache(db);
  const musicVideoLookup = createYtDlpLookup();
  const musicVideoResolver = createMusicVideoResolver(
    musicVideoLookup,
    musicVideoCache,
    (widgetId) => {
      // Same fan-out as canvasResolver: any display whose active scene holds
      // this widget needs a re-push now that the videoId has landed.
      for (const d of displays.list()) {
        const activeId = d.currentSceneId ?? d.defaultSceneId;
        if (!activeId) continue;
        const scene = scenes.get(activeId);
        if (!scene) continue;
        if (scene.widgets.some((w) => w.id === widgetId)) markDisplayDirty(d.id);
      }
    },
  );
```

Use whatever identifier the surrounding code uses for the open database handle (the `db` passed to the repos) rather than assuming the name `db`.

Add `musicVideoResolver,` to the `attachWsHub(...)` options object beside `canvasResolver,` (around line 428).

Pass the cache and lookup to the server builder wherever `buildServer`/`createServer` is called with `haUrl` / `haToken`:

```ts
    musicVideoCache,
    musicVideoLookup,
```

Add to the `gc` call beside `canvasResolver.gc(live);` (line 452):

```ts
    musicVideoResolver.gc(live);
```

And to the shutdown path beside `canvasResolver.dispose();` (line 678):

```ts
      musicVideoResolver.dispose();
```

- [ ] **Step 3: Verify the whole suite and a real build**

Run: `npm test && npm run build`
Expected: PASS, and a clean TypeScript build. A type error here means one of the dep objects is missing the new field.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`, then in another terminal:

```bash
curl -sI http://localhost:8099/api/musicvideo/stream/dQw4w9WgXcQ | head -3
```

Expected with `yt-dlp` installed: `HTTP/1.1 200` and `content-type: video/mp4`. Without it: `HTTP/1.1 404`. Either is a valid pass — the point is the route exists and does not hang or 500.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/src/api/ws.ts
git commit -m "feat(musicvideo): wire cache, lookup, and resolver into the server"
```

---

## Task 8: Display widget, admin editor, and docs

**Files:**
- Create: `display/src/lib/widgets/MusicVideo.svelte`
- Create: `display/src/lib/admin/widgets/MusicVideoConfig.svelte`
- Modify: `display/src/lib/types.ts`
- Modify: `display/src/lib/scene/SceneCanvas.svelte`
- Modify: `display/src/lib/admin/widgetKinds.ts`
- Modify: `display/src/lib/admin/widgets/index.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `MusicVideoData` shape from Task 5, the `/api/musicvideo/stream/:videoId` route from Task 6.
- Produces: nothing consumed by later tasks.

There is no wired display test runner (`display` has no typecheck script and `svelte-check` reports pre-existing errors — see the tech-debt list), so this task is verified by build plus manual check rather than unit tests.

- [ ] **Step 1: Mirror the data type**

In `display/src/lib/types.ts`, add beside `MediaPlayerData` and include it in the display's `WidgetData` union if one exists:

```ts
export type MusicVideoData = {
  entity_id: string;
  video_id: string | null;
  state: MediaPlayerData['state'];
  position?: number;
  duration?: number;
};
```

- [ ] **Step 2: Write the widget**

Create `display/src/lib/widgets/MusicVideo.svelte`:

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { WidgetState, MusicVideoData } from '$lib/types';

  export let widget: WidgetState;

  $: data = widget.data as MusicVideoData | null;
  $: videoId = data?.video_id ?? null;
  $: src = videoId ? `/api/musicvideo/stream/${videoId}` : null;

  let el: HTMLVideoElement | null = null;

  // Position sync. The server's `position` is a snapshot from push time, so
  // advance it by the wall-clock delta since we received it — the same
  // approach MediaPlayer.svelte uses for its progress bar.
  let receivedAtMs = Date.now();
  let pushedPosition: number | null = null;
  $: if (data) {
    receivedAtMs = Date.now();
    pushedPosition = typeof data.position === 'number' ? data.position : null;
  }

  function livePosition(): number | null {
    if (pushedPosition === null) return null;
    if (data?.state !== 'playing') return pushedPosition;
    return pushedPosition + (Date.now() - receivedAtMs) / 1000;
  }

  /** Only correct real divergence — chasing sub-second drift every tick would
   *  stutter the video for no visible gain. */
  const DRIFT_TOLERANCE_S = 3;

  function syncPosition() {
    if (!el) return;
    const target = livePosition();
    if (target === null || !Number.isFinite(target)) return;
    // The video and the track are rarely the same length; wrap so a long song
    // over a short video still lands somewhere sensible rather than past the end.
    const dur = el.duration;
    const seekTo = Number.isFinite(dur) && dur > 0 ? target % dur : target;
    if (Math.abs(el.currentTime - seekTo) > DRIFT_TOLERANCE_S) {
      el.currentTime = seekTo;
    }
  }

  // A new videoId means a new <video> load; seek once metadata is available.
  function onLoadedMetadata() {
    syncPosition();
    void el?.play().catch(() => {});
  }

  // Re-check on each push (covers manual seeks on the media player).
  $: if (el && data) syncPosition();

  // Pause the video when the player pauses, so it doesn't run on alone.
  $: if (el) {
    if (data?.state === 'playing') void el.play().catch(() => {});
    else el.pause();
  }

  onDestroy(() => {
    // Drop the connection to the proxy promptly rather than waiting for GC.
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  });
</script>

{#if src}
  <!-- Muted always: audio belongs to the Home Assistant speaker, not the kiosk.
       `muted` is also what lets autoplay work without user interaction. -->
  <video
    bind:this={el}
    {src}
    class="mv"
    muted
    playsinline
    loop
    autoplay
    on:loadedmetadata={onLoadedMetadata}
  ></video>
{/if}

<style>
  .mv {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: inherit;
    background: #000;
  }
</style>
```

Note the whole component renders nothing when `src` is null — that single branch covers both "still resolving" and "no match found", which is exactly the agreed fallback behavior.

- [ ] **Step 3: Dispatch the kind on the kiosk**

In `display/src/lib/scene/SceneCanvas.svelte`, add the import beside the `Camera` import at line 11:

```svelte
  import MusicVideo from '$lib/widgets/MusicVideo.svelte';
```

And add a branch to the `{#if w.kind === ...}` chain (around line 115, beside the `canvas` branch):

```svelte
        {:else if w.kind === 'musicvideo'}
          <MusicVideo widget={w} />
```

- [ ] **Step 4: Add the admin kind metadata**

In `display/src/lib/admin/widgetKinds.ts`, add an entry to the `widgetKinds` record. Match the shape of the neighboring `camera` entry exactly:

```ts
  musicvideo: {
    kind: 'musicvideo',
    label: 'Music Video',
    category: 'ha',
    icon: widgetIcons.musicvideo,
    accent: '#d9639b',
    blurb: 'Plays the YouTube music video for the current track.',
    defaultSize: { w: 6, h: 4 },
    defaultConfig: (entities) => ({
      entity_id: firstEntityOfDomain(entities, 'media_player'),
    }),
    instanceLabel: (config) => labelFrom(config, 'Music Video'),
  },
```

Add a `musicvideo` entry to `display/src/lib/admin/widgetIcons.ts` — reuse the existing `media_player` icon markup if a distinct one isn't worth drawing.

- [ ] **Step 5: Add the config panel**

Create `display/src/lib/admin/widgets/MusicVideoConfig.svelte`, modeled on the existing `CameraConfig.svelte` (open it first and match its prop contract and markup conventions — it takes the widget config and emits changes the same way every other panel does):

```svelte
<script lang="ts">
  import type { EntityState } from '$lib/types';

  export let config: Record<string, unknown>;
  export let entities: EntityState[] = [];

  $: mediaPlayers = entities.filter((e) => e.entity_id.startsWith('media_player.'));
</script>

<label class="field">
  <span>Media player</span>
  <select bind:value={config.entity_id}>
    {#each mediaPlayers as e (e.entity_id)}
      <option value={e.entity_id}>{e.attributes?.friendly_name ?? e.entity_id}</option>
    {/each}
  </select>
</label>

<label class="field">
  <span>Search suffix</span>
  <input
    type="text"
    placeholder="official music video"
    bind:value={config.query_suffix}
  />
  <small>Appended to "artist title" when searching YouTube.</small>
</label>
```

Adjust the prop names and class names to whatever `CameraConfig.svelte` actually uses — do not invent a new contract.

Register it in `display/src/lib/admin/widgets/index.ts`:

```ts
import MusicVideoConfig from './MusicVideoConfig.svelte';
```

and add `musicvideo: MusicVideoConfig,` to the exported record beside `camera: CameraConfig,`.

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: clean build. A missing-key TypeScript error on the `widgetKinds` record means a required `WidgetKindMeta` field was skipped.

Then `npm run dev`, open `http://localhost:5173/admin`, add a Music Video widget to a scene, bind it to a playing `media_player`, and confirm on the kiosk that the widget is blank for a few seconds and then shows video. Check the server console for the re-push.

- [ ] **Step 7: Update CLAUDE.md**

Add to the Architecture list, after the `voice/` bullet:

```markdown
- `musicvideo/` (server) — Resolves the YouTube music video for a `media_player`'s current track. `trackKey.ts` normalizes `artist|title` (stripping `feat.` / remaster decoration) into a cache key; `ytdlp.ts` shells out to `yt-dlp -f 18 -j ytsearch1:…` behind a `VideoLookup` interface (the only file that knows yt-dlp exists — swap in a YouTube Data API client by writing one new implementation); `cache.ts` is a two-tier SQLite cache (durable `trackKey → videoId`, ephemeral 4h `videoId → streamUrl`, 24h negative results); `resolver.ts` mirrors `createCanvasResolver`'s lifecycle and **never blocks the scene push** — a cache miss returns `null` immediately and fires `onUpdate` → `markDisplayDirty` → re-push once the lookup lands. The kiosk plays the stream from `/api/musicvideo/stream/:videoId`, never a raw googlevideo URL.
```

Add to REST highlights:

```markdown
- `GET /api/musicvideo/stream/:videoId` — proxies the YouTube progressive MP4 to the kiosk, forwarding `Range` and re-deriving expired stream URLs server-side.
```

Add to Known tech debt:

```markdown
- `music_video_cache` is never pruned. Bounded in practice by distinct tracks played, but it grows for the life of the DB — add a pruning pass if it gets large.
- Music video match quality is entirely at the mercy of `ytsearch1` — the first hit may be a lyric video or a cover. The widget's `query_suffix` is the only tuning knob.
- `yt-dlp` is against YouTube's ToS and its extractors break when YouTube changes; a broken extractor degrades to a permanently hidden widget with no user-visible explanation. Requires occasional `yt-dlp -U`. Deliberate, accepted tradeoff — see `docs/superpowers/specs/2026-08-02-music-video-widget-design.md`.
- The music video widget's position sync wraps `position % videoDuration`, so a video shorter than the track restarts at an arbitrary offset rather than at a musically sensible point.
```

Add to the Roadmap:

```markdown
- Plan B (Music Video): ✅ Shipped — `musicvideo` widget resolving YouTube videos for the current track. See `docs/superpowers/plans/2026-08-02-music-video-widget.md`.
```

- [ ] **Step 8: Final verification and commit**

Run: `npm test && npm run build`
Expected: full suite PASS, clean build.

```bash
git add display/src CLAUDE.md
git commit -m "feat(musicvideo): kiosk widget, admin config panel, and docs"
```

---

## Verification Checklist

Before calling this done, confirm each of these by running the command and reading the output — not by assuming:

- [ ] `npm test` — full server suite passes.
- [ ] `npm run build` — clean TypeScript + display build.
- [ ] `grep -rn "child_process" server/src/musicvideo/` returns only `ytdlp.ts`.
- [ ] `grep -rn "yt-dlp" server/test/` returns nothing (the binary never runs in tests).
- [ ] The resolver test asserting an immediate `{videoId: null}` on cache miss passes — this is the guard on the non-blocking-push guarantee.
- [ ] Manual: a widget bound to a playing media player shows video within ~5s, and shows nothing (no error box, no placeholder) when the player is idle.
