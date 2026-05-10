# Canvas calendar bridge

**Status:** Approved 2026-05-09
**Scope:** Single small feature; one implementation plan.

## Problem

Canvas iframes run with `sandbox="allow-scripts"` at null origin. `cosmos.fetch` to the user's HA instance requires the user to add their own HA hostname to the canvas-fetch allowlist — a non-obvious step that feels wrong when Cosmos is already authenticated to HA on behalf of the display. The native calendar widget gets a windowed event list via HA's `calendar.get_events` service through the server-side assembler; canvas widgets currently have no equivalent.

## Solution

Add a typed bridge call:

```ts
cosmos.getCalendarEvents(
  entityId: string,
  startIso: string,
  endIso: string,
): Promise<CalendarEvent[]>
```

`CalendarEvent` is the existing shape exported from `server/src/scenes/types.ts` (also mirrored on the display in `display/src/lib/types.ts`):

```ts
type CalendarEvent = {
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO datetime, or date for all-day
  end: string;
  all_day: boolean;
};
```

Same trust model as `cosmos.entity()` and `cosmos.subscribe()`: no allowlist, no token exposed to the iframe, the server proxies through its existing authenticated HA connection.

## Data flow

```
iframe                          parent display              server
  cosmos.getCalendarEvents
       │  postMessage cosmos:get-calendar-events
       │  { id, entity_id, start, end }
       │
       ▼
                                fetch /api/canvases/<widgetId>/calendar-events
                                ?entity_id=...&start=...&end=...
                                       │
                                       ▼
                                                 calendarCache.get(...)
                                                  ├─ hit:  return cached events
                                                  └─ miss: haClient.getCalendarEvents(),
                                                          store, return
                                                       │
                                       ◀───────────────┘
       ◀────────────────────────────── 200 { events: [...] }
       │  postMessage cosmos:get-calendar-events:result
       │  { id, events } | { id, error }
       ▼
  Promise resolves / rejects
```

## Server

**New module `server/src/ha/calendarCache.ts`:**

- 5-minute TTL, in-memory.
- Cache key: `${entity_id}|${startDay}|${endDay}` where `startDay` / `endDay` are the input ISO strings truncated to the first 10 characters (`YYYY-MM-DD`). Two canvases asking for "events from now to next Tuesday" within the same day reuse one upstream HA RPC.
- Concurrent-call coalescing: the cache stores `Promise<CalendarEvent[]>`, not the resolved array; in-flight requests for the same key share one promise. Mirrors the weather-forecast cache shipped in 0.6.1.
- Pure module; takes the `getCalendarEvents` function as a constructor argument so tests can supply a fake.

**New route `GET /api/canvases/:widgetId/calendar-events`** in `server/src/api/canvases.ts`:

- Query params: `entity_id`, `start`, `end` (all required, all strings).
- Validation: each must be a non-empty string; `start` and `end` must parse as ISO datetimes; `Date(end) > Date(start)`. On any failure → 400 with `{error: 'reason'}`.
- When HA disabled (no `haClient`), responds 200 with the existing `mockCalendar(entityId).events` filtered to the requested window. Same fallback the native widget uses; keeps canvas authoring usable in dev / mock mode.
- When HA enabled, calls `calendarCache.get(...)` and returns `{events}`.
- Errors from the underlying HA call are caught (the existing client method already returns `[]` on failure and logs); the route never 500s for upstream HA hiccups.

The route is wired in `http.ts` next to the existing `/api/canvases/:widgetId/subscribe` registration. The HA client + cache are passed through `HttpDeps` (the cache is constructed in `index.ts` with the live `haClient.getCalendarEvents`).

## Display (kiosk)

`display/src/lib/widgets/canvasBridge.ts`:

- Add `cosmos.getCalendarEvents(entityId, start, end)` to the bridge object. Implementation mirrors `cosmos.fetch`: increment `calendarSeq`, store the resolver pair, post `{type: 'cosmos:get-calendar-events', id, entity_id, start, end}` to the parent.
- Add the `cosmos:get-calendar-events:result` branch to the message handler — resolves or rejects the pending promise.

`display/src/lib/widgets/Canvas.svelte`:

- Handle the new `cosmos:get-calendar-events` message: call `fetch('/api/canvases/<widgetId>/calendar-events?...')`, post the result (or error) back as `cosmos:get-calendar-events:result`.
- 15 s timeout (matches `cosmos.fetch` posture).
- Errors surface as plain strings on the `error` field. Iframe-side, the promise rejects with `new Error(error)`.

## Documentation

**Mandatory updates** to keep canvas authors and the in-product agent aware of the new path:

1. `docs/canvas-widget-agent.md` — new "Calendar events" subsection under "What's available". Code example. Explicit note: **prefer `cosmos.getCalendarEvents` over `cosmos.fetch` to your HA instance for calendars** — no allowlist required, server-side authenticated, cached.
2. `docs/canvas-widget.md` — matching user-facing section.
3. `display/src/lib/admin/canvas-help.md` — one-line entry in the API reference table so the editor's "How this works" panel surfaces it.
4. `CLAUDE.md` (root) — extend the canvas widget summary line to mention the bridge exposes `cosmos.{entity, subscribe, getCalendarEvents, ...}`.
5. `addon/CHANGELOG.md` — version bump entry.

The agent doc must explicitly call out: this is the **only HA service-call bridge today**. Do not invent `cosmos.callService(...)` or similar — they don't exist. If a canvas needs another HA service call, the user can request one and we'll add it case by case.

## Tests

**`server/test/calendar-cache.test.ts` (new):**
- Cache hit returns cached events without re-invoking the upstream.
- Two requests within the same day-bucket dedupe to one upstream call.
- Two requests across different day-buckets each hit upstream.
- Concurrent-call coalescing: two in-flight `get(...)` calls before resolution share one upstream invocation.
- TTL expiry: after the configured TTL, next call hits upstream again.

**`server/test/canvas.test.ts` (extend):**
- 400 on missing / non-ISO / inverted `start`/`end` and missing `entity_id`.
- 200 + cached events on the happy path.
- 200 + mock events when HA disabled.

**Display:** No new tests — bridge plumbing is symmetrical to `cosmos.fetch`, which already has end-to-end coverage via the existing canvas tests.

## Out of scope

- Generic HA service-call proxy (`cosmos.callService`).
- Per-canvas rate limiting beyond the cache. If a hostile canvas varies its date params on every call to defeat the cache, the next iteration adds a per-(display, widget) rate limit. Not now.
- Pagination, attendee lists, recurrence-rule expansion, or any data not already in `CalendarEvent`.
- Subscribing to live calendar updates. Calendar entities don't fire `state_changed` on event mutation in HA, so there's no clean push path. Authors who want freshness should call `getCalendarEvents` on a timer (cache absorbs the cost).
