# Music Video Widget — Design

**Date:** 2026-08-02
**Status:** Approved, pending implementation plan

## Summary

A new `musicvideo` widget kind that watches a `media_player` entity and plays the
matching YouTube music video for whatever track is currently playing. The video is
muted and grid-placed; audio continues to come from the Home Assistant speaker.

Video lookup runs server-side via `yt-dlp`, results are cached in SQLite, and the
stream is proxied through the Cosmos server to the kiosk.

## Decisions

| Question | Decision |
|---|---|
| Surface | New `musicvideo` widget kind, placed in the scene grid |
| Sourcing | `yt-dlp` search + stream extraction (no API key, no quota) |
| Stream delivery | Proxied through the Cosmos server |
| Format | `-f 18` (progressive 360p MP4, muxed) |
| Track position | Video seeks to match the media player's position |
| No match / loading | Widget renders nothing (hidden) |

### Accepted tradeoff: yt-dlp

`yt-dlp` violates YouTube's Terms of Service and its extractors break when YouTube
changes. This was raised and accepted: for a personal wall dashboard the tradeoff is
reasonable, and it requires occasional `yt-dlp -U` maintenance.

To keep that decision reversible, all yt-dlp knowledge is confined to a single file
behind a `VideoLookup` interface. Swapping to the YouTube Data API v3 later means
writing one new implementation of that interface and changing one wiring line.

### Why `-f 18`

Higher-resolution YouTube formats are DASH-only fragmented streams that do not play in
a bare `<video>` tag. Format 18 is progressive MP4 with muxed audio, universally
playable, and supports byte-range seeking — which the position-sync requirement needs.
360p is sufficient for a grid-placed widget.

### Why proxy rather than hand the URL to the display

`yt-dlp` returns a `googlevideo.com` URL that expires in roughly six hours and is often
bound to the IP that resolved it. The server resolves it; the kiosk plays it; those are
different machines. Proxying solves IP-binding, CORS, and expiry together — the display
never holds a googlevideo URL, so an expired one is re-resolved server-side
transparently.

Pre-downloading files to disk was considered and rejected: unbounded disk growth and
10–30s before the first frame.

## Architecture

### `server/src/musicvideo/`

**`types.ts`**

```ts
export interface MusicVideoConfig {
  entity_id: string;          // required — the media_player to follow
  query_suffix?: string;      // default "official music video"
}

export interface ResolvedVideo {
  videoId: string;
  streamUrl: string;
  duration: number;           // seconds
  title: string;
}

// Three outcomes, because the resolver treats them differently: only 'none'
// (the lookup ran and found nothing) may be negative-cached. 'unavailable'
// (yt-dlp missing / spawn refused) must retry, or every track played before
// the user installs yt-dlp stays poisoned for 24h afterwards.
export type VideoSearchResult =
  | { status: 'ok'; video: ResolvedVideo }
  | { status: 'none' }
  | { status: 'unavailable' };

export interface VideoLookup {
  search(query: string): Promise<VideoSearchResult>;
  streamUrlFor(videoId: string): Promise<string | null>;
}
```

**`ytdlp.ts`** — the only file that knows yt-dlp exists. Spawns
`yt-dlp -f 18 -j "ytsearch1:<query>"`, parses JSON, returns `ResolvedVideo`.
Hard timeout of 15s that **kills the child process**. Non-zero exit, malformed JSON,
empty results, and timeouts all report `{status:'none'}`; a failed spawn (ENOENT)
reports `{status:'unavailable'}`. Never throws. `probeYtDlpAvailable()` runs
`yt-dlp --version` once at startup so a missing binary is logged once, not per lookup.

**`cache.ts`** — SQLite-backed, two tiers with different lifetimes:

- **Durable:** `track_key → videoId`. Never goes stale; written once, read forever.
- **Ephemeral:** `videoId → streamUrl` with `resolved_at`. YouTube expires these in
  roughly 6h, so Cosmos treats a row older than **4h** as stale and re-derives it on
  demand via `streamUrlFor`. The 2h margin means a stream is never handed out close to
  its true expiry.
- **Negative:** `miss = 1` rows with a ~24h TTL, so an unmatchable track stops
  respawning the subprocess but can be picked up later.

```sql
CREATE TABLE music_video_cache (
  track_key   TEXT PRIMARY KEY,   -- normalized "artist|title"
  video_id    TEXT,               -- NULL when miss = 1
  miss        INTEGER NOT NULL DEFAULT 0,
  resolved_at INTEGER NOT NULL
);

CREATE TABLE music_video_stream (
  video_id    TEXT PRIMARY KEY,
  stream_url  TEXT NOT NULL,
  duration    INTEGER,
  resolved_at INTEGER NOT NULL
);
```

`track_key` normalization: lowercase, collapse whitespace, strip `feat. …` /
`(feat. …)` and remaster/version suffixes such as `- Remastered 2011`, then join as
`artist|title`.

Video bytes are explicitly **not** cached to disk.

**`resolver.ts`** — `createMusicVideoResolver(lookup, cache, onUpdate)`, mirroring
`createCanvasResolver`'s signature and lifecycle (`dispose`, `gc`).

### Non-blocking resolution

`assembleScene` is awaited on the scene-push path, and a yt-dlp call takes 2–5s.
The resolver therefore never blocks:

- **Cache hit** → returns the `videoId` immediately.
- **Cache miss** → returns `null` immediately, spawns the lookup in the background, and
  calls `onUpdate(widgetId)` when it lands. The host wires that to the existing
  `markDisplayDirty` machinery, triggering a normal re-push.

The widget is hidden for those seconds and then appears. This is why "hidden" is the
right fallback: it doubles as the loading state, so there is no flicker between two
different placeholder appearances.

Only one in-flight lookup per `track_key` is permitted; concurrent requests for the same
track share it. Total concurrent lookups are capped at `MAX_CONCURRENT_LOOKUPS` (3) so
rapid track-skipping can't spawn a pile of 15-second processes on a Raspberry Pi;
requests past the cap return `{videoId: null}` and the next scene push retries.

### Proxy route — `server/src/api/musicvideo.ts`

`GET /api/musicvideo/stream/:videoId`

1. Look up `stream_url` for `videoId`.
2. If absent or `resolved_at` older than 4h, call `lookup.streamUrlFor(videoId)` and
   persist the result.
3. Pipe the upstream response through, forwarding the client's `Range` header and
   relaying `Content-Range`, `Content-Length`, `Accept-Ranges`, and `Content-Type`.
4. Unknown `videoId`, or a resolution that fails, → 404.
5. **On client disconnect, destroy the upstream stream.**

### Display — `display/src/lib/widgets/MusicVideo.svelte`

Renders nothing when `widget.data` has no `videoId`. Otherwise a
`<video muted playsinline loop autoplay>` with
`src="/api/musicvideo/stream/<videoId>"`, `object-fit: cover`.

**Position sync.** On load, `video.currentTime` is set from the media player's live
position, reusing the same clock-drift math `MediaPlayer.svelte` already computes
(`lastPosition` advanced by wall-clock delta since the last push). Thereafter it
re-syncs only when the reported position diverges from the video's by more than 3s,
which catches manual seeks without fighting natural drift every second.

If the video is shorter than the track, it loops.

### Registration

- Add `'musicvideo'` to `WIDGET_KINDS` in `server/src/store/scenes.ts`.
- Add the kind to `display/src/lib/admin/widgetKinds.ts` (label, icon, default config,
  editor fields: entity picker + optional query suffix).
- `validateWidget` in `server/src/api/scenes.ts` treats `musicvideo` as entity-bearing,
  so `entity_id` is required and syntactically validated.
- Assembler dispatch: a `musicvideo` case that degrades to `null` data when no resolver
  is wired, mirroring how `canvas` degrades without `canvasResolver`.

## Error handling

Every failure path resolves to the same hidden widget:

| Failure | Behavior |
|---|---|
| `yt-dlp` not on `PATH` | `null`; logged once at startup, not per lookup |
| Lookup timeout | Child process **killed**; `null`; negative-cached |
| No search results | `null`; negative-cached |
| Malformed JSON | `null`; not cached (likely transient/extractor breakage) |
| Stream URL expired | Re-resolved by the proxy on next request |
| Upstream 403/404 | Proxy returns 404; stream row invalidated |
| Client disconnects mid-stream | Upstream stream destroyed |
| Media player idle / no track | Widget hidden; no lookup |

Two resource-leak hazards are called out explicitly because the codebase has a
documented precedent for exactly this class of bug in `voice/relay.ts`: the yt-dlp
timeout must kill the child, and the proxy must destroy its upstream on client
disconnect.

## Testing

TDD per project convention — failing test first. **`yt-dlp` never runs in the test
suite**; the `VideoLookup` interface is injected with a fake. That is the primary
reason the seam exists.

**`server/test/musicvideo.cache.test.ts`**
- `track_key` normalization: case-folding, `feat.` stripping, `- Remastered 2011`
  stripping, whitespace collapse
- durable hit/miss
- stream-URL TTL expiry
- negative caching and its shorter TTL

**`server/test/musicvideo.ytdlp.test.ts`** (fake spawn)
- valid JSON parses into `ResolvedVideo`
- malformed JSON → `null`
- non-zero exit → `null`
- empty search result → `null`
- timeout kills the child process and returns `null`

**`server/test/musicvideo.resolver.test.ts`**
- cache hit returns without spawning a lookup
- cache miss returns `null` **immediately** and fires `onUpdate` once resolved
  (this test protects the non-blocking-push guarantee — the easiest thing to regress)
- concurrent requests for the same `track_key` share one in-flight lookup
- `dispose` / `gc` drop per-widget state

**`server/test/musicvideo.api.test.ts`**
- `Range` header forwarded; `Content-Range` relayed
- 404 on unknown `videoId`
- stale `resolved_at` triggers re-resolution
- client disconnect destroys the upstream stream

**`server/test/assembler.test.ts`** (extend)
- `musicvideo` widget assembles with a resolver wired
- degrades to `null` data with no resolver wired

## Out of scope

- Caching video bytes to disk
- Full-screen / takeover presentation
- User-facing "wrong video, pick another" override UI
- Non-YouTube sources
- Audio from the video (always muted; HA speaker owns audio)

## Follow-ups to note as tech debt

- `music_video_cache` grows unbounded across the life of the DB. Bounded in practice by
  distinct tracks played, but worth a pruning pass if it becomes large.
- Match quality is entirely at the mercy of `ytsearch1` — the first hit may be a lyric
  video or a cover. `query_suffix` is the only tuning knob.
- yt-dlp requires periodic updating; a broken extractor degrades to a permanently hidden
  widget with no user-visible explanation.
