# Lyrics Widget — Design

Date: 2026-10-25
Status: Draft for approval

## Intent

A `lyrics` widget a user adds to a scene, like the video backdrop (`musicvideo`). It watches a
`media_player` and shows the lyrics for whatever is playing, when lyrics exist. It serves two
moods with one widget: **singing along** (current line clear and on-beat) and **atmosphere**
(words as part of the room's look). The user picks a display **style** per widget; four ship.

Success: put on a song, the wall shows its words in time, beautifully, from across the room —
and when there are no lyrics, nothing awkward is on screen.

## Goals

- New widget kind `lyrics`, configured with a `media_player` entity.
- Lyrics sourced from **LRCLIB** (`https://lrclib.net`, free, no API key). Synced (LRC,
  line-timestamped) preferred; plain text accepted.
- Four user-selectable styles (mockups were approved in the brainstorm):
  - **`spotlight`** — Spotify-like. Lines scroll upward; the line being sung is bright and
    slightly larger, others dim. Top/bottom fade mask. (User-requested baseline.)
  - **`karaoke`** — one big current line; a colour fill sweeps left→right across it, with the
    next line smaller beneath.
  - **`poster`** — kinetic typography: each line becomes a typeset "poster", mixing sizes,
    weights and fonts (scene font + Fraunces italic + JetBrains Mono caps), varying per line,
    with a blur/scale in-out between lines.
  - **`drift`** — ambient: lines fade in at loose positions, linger, float up and dissolve.
    Meant to sit over an aerial or mood video.
- **Chorus emphasis** (all styles): a line whose normalized text occurs more than once in the
  song is "chorus". Poster and Drift render chorus lines in the accent colour with a glow;
  Spotlight and Karaoke use a subtle accent tint.
- Timing is **clock-skew-proof**: the server (same clock domain as HA) extrapolates HA's
  `media_position` + `media_position_updated_at` to "position as of this push" and ships that as
  `position`; the kiosk anchors it to the message's arrival time on its own clock
  (`performance.now()`) and advances it while `playing`, freezes it while `paused`. No comparison
  between kiosk and HA wall clocks ever happens. *(Builder-check decision: the video backdrop's
  approach compares kiosk time against HA's timestamp and tolerates 3 s of error — not good enough
  for lyrics. The musicvideo widget is left as-is.)*
- Per-widget **sync offset** (ms, ±) to nudge timing for speakers that report position late/early.
- Text uses the scene's font and colours by default, with an optional **accent colour** override.

## Non-goals

- Word-level timing. LRCLIB is mostly line-level; Karaoke spreads the fill evenly across a
  line's duration. Enhanced-LRC word tags, if present, are ignored (strip them).
- Translation, romanization, or editing lyrics.
- A manual lyrics pin/block admin page like the music-video overrides page.
- Any other lyrics provider.

## Anti-goals (failure even if it "works")

- Lyrics visibly out of sync by more than a beat in normal use.
- Blocking or slowing the scene push on a network lookup.
- An empty box, error text, or "no lyrics found" on the wall. No lyrics → widget hidden.
- Janky motion on the kiosk (layout-thrashing animations, per-frame Svelte re-renders of the
  whole lyric list).

## Behaviour details (decided)

- **Hidden** when: no entity, player not in an active state, non-music content type (reuse
  `MV_NON_MUSIC_TYPES`), lookup pending, or LRCLIB has nothing / marks the track instrumental.
- **Plain lyrics only** (no timestamps):
  - Spotlight: slow continuous auto-scroll paced so the text spans the track duration, no highlight.
  - Karaoke / Poster / Drift: step through lines at an even pace across `media_duration`
    (no sweep in Karaoke). Not in sync with the vocal; acceptable for atmosphere.
  - If duration is unknown, step at a fixed ~4 s/line.
- **Instrumental gaps** (synced lyrics, gap between line end and next line start > ~5 s, and
  before the first line): Spotlight and Karaoke show a soft pulsing "♪ ♪ ♪"; Poster and Drift
  show nothing.
- A line's "end" is the next line's timestamp; the last line ends at track duration (or +5 s).
- Empty LRC lines (`[01:23.45]` with no text) are instrumental markers, not lines.

## Architecture (follows the musicvideo pattern)

### Server — new `server/src/lyrics/`

- `lrclib.ts` — the only file that knows LRCLIB exists. `GET /api/get?artist_name&track_name
  [&duration]` (duration in whole seconds when known); on 404 fall back to
  `/api/search?track_name&artist_name` and take the first result whose duration is within
  ~3 s; if duration is known and nothing is within ~3 s, treat it as **not found** (wrong lyrics
  are worse than none — same accuracy-over-coverage call as music video). Only when duration is
  unknown, take the first result. Strip title decoration (`(Remastered 2011)`, `- Live`, `feat.`)
  before querying, reusing `trackKey.ts` normalization logic where it fits. Sends a descriptive `User-Agent`
  (`Cosmos Dashboard (https://github.com/qrobinso/cosmos-ha-dashboard)`) as LRCLIB requests.
  Returns `{ synced: string | null, plain: string | null, instrumental: boolean } | null`.
  Timeout ~8 s.
- `parse.ts` — pure: LRC text → `{ t: number /* seconds */, text: string }[]`, sorted;
  handles multiple timestamps on one line, `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]`, `[offset:±ms]`
  tag, metadata tags (`[ar:]`, `[ti:]`…) ignored, enhanced `<mm:ss.xx>` word tags stripped.
  Plain text → lines with no `t`. Also computes chorus flags.
- `cache.ts` — SQLite table `lyrics_cache` (new migration): `track_key` (from musicvideo's
  `normalizeTrackKey`) → `synced`, `plain`, `instrumental`, `fetched_at`. Positive rows durable
  (capped, oldest-first, like `MAX_CACHE_ROWS`); negative rows (nothing found) expire after 24 h;
  network errors are **not** cached. Pruned with the same boot/hourly hook as `cache.prune()`.
- `resolver.ts` — mirrors `createMusicVideoResolver`: **synchronous**, cache hit returns lyrics,
  miss returns `null` immediately and starts a deduped background fetch (per track key), then
  fires `onUpdate(widgetId)` → `markDisplayDirty` → re-push. Concurrency cap (small, e.g. 2).
  `dispose`/`gc` lifecycle like the others.

### Assembler

- New `lyricsResolver?` on `DataResolvers`; new `case 'lyrics'` in the widget-data switch
  producing `LyricsData`:
  ```ts
  type LyricsLine = { t?: number; text: string; chorus?: boolean };
  type LyricsData = {
    entity_id: string;
    state: string;
    lines: LyricsLine[] | null;   // null = hide
    synced: boolean;
    position?: number;            // seconds, extrapolated by the server to push time
    duration?: number;
    track_key?: string;           // lets the display detect a track change cheaply
  };
  ```
  Reuse the same entity-attribute reading as `musicVideoData` (factor out a shared helper if it
  is a straight copy; don't duplicate the denylist).
- Parsed lines ship inline in `SceneState` (a few KB). Accepted: media players re-push often,
  but this is LAN traffic and matches how every other widget ships data.
- Preview route (`/api/scenes/:id/preview`): lyrics resolver is stateless enough to include if
  wired; otherwise the widget renders hidden in preview, same as musicvideo.

### Wiring

`index.ts` constructs cache + resolver, passes into `DataResolvers`, adds to gc and prune hooks.
`api/scenes.ts` `WIDGET_KINDS` + `validateWidget` treat `lyrics` as entity-bearing
(`media_player.*`). MCP/agent docs (`docs/scene-agent.md`) get the new kind and its config.

### Display

- `display/src/lib/widgets/Lyrics.svelte` — thin shell: computes current position (a Svelte
  store ticking via `requestAnimationFrame` — the display is Svelte 4 — anchored to the push's
  arrival time, plus `offset_ms`), derives current line index, and dispatches on `config.style` to
  `display/src/lib/widgets/lyrics/{Spotlight,Karaoke,Poster,Drift}.svelte`.
- Pure helper `lyrics/timing.ts`: `currentIndex(lines, pos)`, `lineProgress(lines, i, pos, dur)`,
  `isGap(...)`, plain-lyrics pacing. Unit-tested.
- Motion via CSS transforms/opacity/clip-path only (GPU-friendly). Spotlight translates one
  list container; Karaoke animates `clip-path` driven by a CSS custom property; Poster/Drift
  mount only the current (and outgoing) line.
- Poster layout: deterministic per line (seeded from line index + text hash) so the same line
  always looks the same; chooses among a handful of typographic recipes (big-heavy word +
  serif italic tail; mono caps lead-in + giant word; split stacked words). Longest/rarest word
  in the line gets the large treatment.
- Drift: deterministic pseudo-random positions within safe bounds of the widget box; at most
  ~3 lines visible at once (current + 2 fading).
- Registered in `SceneCanvas.svelte` / `WidgetSlot.svelte` like `MusicVideo`.

### Admin editor

- `widgetKinds.ts` + `widgetIcons.ts` entry; config component
  `display/src/lib/admin/widgets/LyricsConfig.svelte` with: media player picker (reuse the one
  `MusicVideoConfig` uses), **Style** select (Spotlight / Karaoke / Poster / Drift), **Accent
  colour** (optional), **Sync offset** (ms, number input, default 0, step 100).
- `defaultConfig`: `{ entity_id: '', style: 'spotlight', offset_ms: 0 }`.

## Config

```ts
type LyricsConfig = {
  entity_id: string;            // media_player.*
  style?: 'spotlight' | 'karaoke' | 'poster' | 'drift';  // default 'spotlight'
  accent?: string;              // CSS colour; default derived from scene palette
  offset_ms?: number;           // default 0; positive = lyrics earlier
};
```

## Testing

- Server: `parse.ts` fixtures (synced, multi-timestamp, enhanced word tags, offset tag,
  plain, empty lines, chorus detection); `lrclib.ts` with a fake fetch (get hit, get 404 →
  search, duration matching, instrumental, network error); cache TTL/prune; resolver
  sync-return/dedupe/onUpdate; assembler `lyrics` case (hidden states, data shape).
- Display: `timing.ts` unit tests; a `Lyrics.test.ts` smoke test per style mounting with
  fixture data like `MusicVideo.test.ts`.

## Reference

Approved style mockups: `.superpowers/brainstorm/25388-1792959558/content/lyric-styles-v2.html`
(gitignored, local only).

## Left to the builder

- Exact animation timings, easings, sizes and poster recipes (stay within the approved mockups
  and the kiosk's "calm and beautiful" bar).
- Default accent derivation from the scene palette.
- Concurrency cap and positive-row cap values.
- Whether to factor a shared media-player-attribute reader out of `musicVideoData`.
