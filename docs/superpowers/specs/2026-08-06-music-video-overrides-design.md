# Music Video Overrides — Design

**Date:** 2026-08-06
**Status:** Approved, pending implementation plan

## Problem

The `musicvideo` widget resolves a YouTube video for the currently playing track
automatically, and deliberately errs toward showing nothing over showing the wrong
thing. Two hard requirements gate every candidate (`musicvideo/ytdlp.ts`): the title
must contain both "official" and "video", and the channel must be the artist's own.
Survivors must then clear `MIN_SCORE`.

That trade is measured and accepted — across twelve well-known songs, seven play and
five show nothing, including four with famous official videos whose titles simply lack
the required wording (`Kendrick Lamar - HUMBLE.`, `Radiohead - Karma Police`,
`Taylor Swift - Blank Space`, `Billie Eilish - bad guy`). It is also irreducible:
relaxing the title requirement restores the Art Track problem documented in `score.ts`,
where YouTube's auto-generated audio uploads beat the real video on every other signal.

So the automatic matcher will always have a tail it cannot serve. There is currently no
way for a user to correct it. This design adds one.

## Goals

- Pin a specific YouTube video to a specific song, permanently.
- Block a song from ever playing a video.
- Do both for songs playing right now *and* for songs Cosmos resolved recently —
  including the ones where it found nothing, which is the common case and the one you
  cannot catch in the moment, because a hidden widget gives no prompt.
- Never silently accept a bad link.

## Non-goals

- Per-scene or per-widget overrides. A pin is a fact about a song, not about a layout.
- Editing the scoring weights from the UI. Those are tuned against fixtures
  (`musicvideo.score.test.ts`) and retuning by feel has already broken a case once.
- Browsing or searching YouTube from the admin console. The user picks the video on
  YouTube and pastes the link.

## Storage

A new table, added in **migration v12**:

```sql
CREATE TABLE music_video_override (
  track_key  TEXT PRIMARY KEY,   -- normalizeTrackKey() output, same as the cache
  video_id   TEXT,               -- NULL = blocked ("never play")
  artist     TEXT,               -- as displayed, for the admin list
  title      TEXT,
  created_at INTEGER NOT NULL
);
```

The same migration adds nullable `artist` and `title` display columns to
`music_video_cache`. Without them the History list can only render `track_key`, which is
lowercased and decoration-stripped — `solange|weary`. They are written by
`cache.putVideoId`, whose signature gains an optional display-name argument that the
resolver passes through from the `TrackRef` it already holds. Rows written before v12
have NULL there, so the History list falls back to rendering the `track_key` for them.

### Why a separate table

Reusing `music_video_cache` with a `pinned` flag was considered and rejected for a
concrete reason, not an aesthetic one: `cache.prune()` caps that table at
`MAX_CACHE_ROWS` and deletes oldest-first, so a pin set months ago would eventually be
evicted by routine maintenance. The cache is machine-derived, disposable, and pruned;
overrides are user intent, durable, and must never be evicted. Different lifetimes,
different tables.

A settings JSON blob was also rejected — unbounded growth in one row, no recent-first
query.

### Blocked vs negatively cached

`video_id IS NULL` with a row present means blocked, and is permanent. That is
distinguishable from having no row at all, which is what the cache's 24-hour negative
TTL decays to. A blocked song therefore never gets retried; an unmatched one still does.

## Resolution

`createMusicVideoResolver` gains one check ahead of everything else:

```
override = overrides.get(trackKey)      // synchronous prepared-statement read
  row exists, video_id set  -> return { videoId }         // pinned
  row exists, video_id NULL -> return { videoId: null }   // blocked, no lookup
  no row                    -> existing cache/lookup path, unchanged
```

Because the override is consulted first, a stale or wrong cache row for that track is
shadowed rather than needing deletion. The read is synchronous, preserving the
resolver's contract of never blocking the scene push.

Two consequences:

**Stream URLs need no new machinery.** The kiosk requests
`/api/musicvideo/stream/:videoId`, and that route already re-derives an absent or
expired URL on demand. A pinned videoId with nothing in the stream cache just works.

**Duration does.** `MusicVideo.svelte` wraps playback position against the video's
duration, which lives in the stream cache beside the URL. `VideoLookup.streamUrlFor`
returns a bare URL — no title, no duration. So the interface gains one method:

```ts
probe(videoId: string): Promise<{
  videoId: string;
  title: string;
  durationSec: number;
  streamUrl: string;
} | null>
```

One `yt-dlp -f 18 -j` call. It serves save-time validation (returning the title and
duration to display back, `null` if unplayable) *and* populates the stream cache in the
same step, so a pin is immediately playable. It sits behind the existing `VideoLookup`
interface, preserving the property that a YouTube Data API implementation could be
swapped in by writing one new file.

**Applying immediately.** Saving or deleting an override marks all displays dirty, so a
pin set while the song is playing swaps within a push rather than at the next track
change. Displays are few and the event is rare, so a blanket dirty-mark is the right
trade against threading widget ids through the API layer.

## New module: `musicvideo/youtubeUrl.ts`

A pure `parseYouTubeId(input: string): string | null` handling the shapes a user
actually pastes:

- `https://www.youtube.com/watch?v=ID` with arbitrary extra params (`&t=`, `&list=`, `?si=`)
- `https://youtu.be/ID?si=...`
- `https://music.youtube.com/watch?v=ID`
- `https://www.youtube.com/shorts/ID`
- a bare 11-character id

Pure and exhaustively unit-tested. "Paste a share link" is the feature's entire input
surface, and share links are messy.

## API

Extends `api/musicvideo.ts`.

| Route | Purpose |
|---|---|
| `GET /api/musicvideo/now-playing` | Artist, title, trackKey, and current resolution state for the configured entity |
| `GET /api/musicvideo/overrides` | Every pin and block, newest first |
| `POST /api/musicvideo/overrides` | `{artist, title, url}` → parse, probe, save; or `{artist, title, block: true}` |
| `DELETE /api/musicvideo/overrides/:trackKey` | Restore automatic resolution |
| `GET /api/musicvideo/history` | Recent resolutions from `music_video_cache`, newest first, capped at 50 |

The client never computes a `track_key`. `POST` takes the raw `artist` and `title` and
runs them through `normalizeTrackKey` server-side, so the admin page and the resolver
can never disagree about what key a song maps to. `DELETE` is the one exception, and
takes the key verbatim from the list the server just returned.

A `block: true` body skips `probe` entirely — there is no video to validate — and writes
a row with `video_id` NULL.

`POST` returns `400` with a distinct message per failure — unparseable link, video
unplayable, yt-dlp unavailable — rather than a generic error. Diagnosing a bad paste is
the point of resolving on save.

The watched `media_player` entity is one new key in the existing settings KV repo,
read and written through the page.

## Admin page

`/admin/musicvideo`, in the standard `.cosmos-admin` shell with the `eyebrow` + `h1`
page-header pattern and `.card` surfaces. One entry added to the `links` array in
`display/src/routes/admin/+layout.svelte`.

Four stacked sections:

1. **Entity picker** — a `media_player` dropdown, saved on change.
2. **Now Playing** — artist and title, a `.tag` pill showing current state
   (*Pinned* / *Auto-matched* / *Nothing found* / *Blocked*), a paste field with
   **Save**, and a **Never play** action. After a save, the resolved title and duration
   render back as confirmation — which also catches pasting the wrong clipboard entry.
3. **Overrides** — table of pins and blocks, each with **Remove** to restore automatic.
4. **Recent** — the last 50 resolutions, each with **Pin** / **Block** actions that
   prefill section 2 for that song. This is where the "found nothing" cases get caught.

Mobile-first stacking, broadening at the existing 600px / 720px breakpoints. All color
from theme CSS variables — nothing hardcoded.

## Error handling

- **Unparseable link** — `400`, inline message naming what was expected.
- **Video unplayable** (private, removed, region-locked, age-gated) — `probe` returns
  `null`, `400`, the override is not saved. Failing the save is deliberate: the whole
  reason for this page is that resolution already failed silently once.
- **yt-dlp unavailable** — `400` distinguishing "cannot check right now" from "this
  video is bad", so the user retries rather than hunting for a different link.
- **No `media_player` configured, or nothing playing** — Now Playing renders an empty
  state pointing at the History list.
- **HA disconnected** — the entity picker and Now Playing degrade to an explanatory
  empty state; Overrides and History still work, since both are pure DB reads.

## Testing

TDD throughout, per repo convention. `:memory:` SQLite with real repo factories; a fake
`VideoLookup` supplies `probe`.

- `parseYouTubeId` across every URL shape above, plus junk input.
- Override repo: put, get, list ordering, delete, block round-trip.
- Migration v12: applies cleanly over a v11 database with existing cache rows.
- Resolver precedence: a pin beats a conflicting cache row; a block suppresses the
  lookup entirely (assert no search is spawned); a block still suppresses after the
  24-hour negative-cache TTL would have expired.
- Each route's success and error paths, including every distinct `400`.
- `probe` populating the stream cache, so a fresh pin is immediately playable.

## Documentation

- `CLAUDE.md` — note the override layer in the `musicvideo/` bullet.
- `server/CLAUDE.md` — new table, new routes, `LOG_MUSICVIDEO` coverage of override hits.
- `docs/` — user-facing note that pinning exists and where to find it.
- `addon/DOCS.md` and `CHANGELOG.md` — user-visible feature, so it needs a changelog
  entry and an addon version bump.
