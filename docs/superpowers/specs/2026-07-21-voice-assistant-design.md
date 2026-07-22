# Voice Assistant (Wake Word → HA Assist) — Design

## Summary

Add an optional, per-display "always-on mic" feature to Cosmos. A kiosk display runs local wake-word detection (openWakeWord, in-browser via WASM/ONNX); on wake it captures the utterance, streams it through the existing display↔server WebSocket to the Cosmos server, which relays it to Home Assistant's `assist_pipeline/run` WebSocket command. HA's configured pipeline (STT → intent/conversation agent → TTS) does all the actual speech understanding; Cosmos never implements STT, NLU, or TTS itself. The response text and audio are streamed back to the display, shown as an overlay, and played through the kiosk's own speakers.

No HA device entity is created (no Wyoming satellite implementation) — this is a scripted client of HA's existing Assist pipeline, the same mechanism HA's own dashboard "Assist" mic button uses.

## Non-goals

- No custom/local intent handling in Cosmos — HA Assist owns all NLU.
- No Wyoming protocol server, no `assist_satellite` HA entity.
- No cross-display shared mic — each display's mic (if any) is independent.
- No on-kiosk mute button or visible "mic active" indicator — control is admin-only.
- No support for HA instances without Assist configured; if no pipeline exists, the feature has nothing to call and stays inactive.

## Architecture

```
[Kiosk browser]                          [Cosmos server]                      [Home Assistant]
 mic --Web Audio-->                                                            
 openWakeWord (WASM, local, continuous)
   |
   | wake detected -> capture utterance (silence-terminated, ~5s cap)
   v
 ws.ts (existing WS conn)
   --{type:'voice_audio', chunk}-->  voice/ relay module
                                        |
                                        | opens dedicated HA WS conn
                                        | (separate from ha/ client's
                                        |  state_changed subscription)
                                        v
                                      assist_pipeline/run (start_stage: stt,
                                      pipeline: display's configured pipelineId)
                                                                            --> STT -> conversation agent -> TTS
   <--{type:'voice_result', stage, ...}--  forwards stt-end/intent-end/tts-end
   |
 overlay shows listening -> thinking -> response text
 <audio> element plays tts-end audio url through kiosk speakers
```

## Components

### `display/src/lib/voice/`
New, self-contained module, mounted only when the display's config has `voiceEnabled`. Mirrors how `moods` mounts a `<video>` conditionally.

- `wakeword.ts` — loads the openWakeWord ONNX model (bundled asset, same static-serving pattern as mood videos under `display/static/`), runs continuous inference over mic frames via Web Audio `AudioWorklet`.
- `capture.ts` — on wake event, buffers PCM audio until a simple silence/timeout heuristic ends the utterance (cap ~5s), chunks it for streaming.
- `index.ts` — wires into the existing `ws.ts` connection: sends `voice_audio` frames, listens for `voice_result` frames, drives overlay state transitions (listening/thinking/response) via the same overlay display path already used for `OverlayPushMessage`.
- Mic permission failure, model load failure, or WS send failure → module logs and goes idle; no on-screen error, per design. It periodically reports mic health (see below).

### `display/src/lib/ws.ts`
Extend the existing `ServerMessage` union (`display/src/lib/ws.ts:7-13`) with:
```ts
type VoiceResultMessage = { type: 'voice_result'; stage: 'stt-end' | 'intent-end' | 'tts-end' | 'error'; data: unknown }
```
and the client→server side gains `voice_audio` (binary or base64 chunk) and `voice_health` (periodic mic status ping) message types. This is an additive change to the union — no existing message type changes shape. `connect()`'s reconnect/backoff and liveness-ping logic (`ws.ts:33-83`) is untouched and covers the voice channel for free since it rides the same socket.

### `server/src/voice/`
New sibling module to `moods/`, `overlay/`, `mqtt/` — same shape convention:
- `types.ts` — `VoiceAudioFrame`, `VoiceResult`, per-display voice config type.
- `client.ts` — `makeVoiceHaClient(config: HaConfig)`, structured like `server/src/ha/client.ts:56` (`createLongLivedTokenAuth` + `createConnection`, same `ws` global polyfill guard at `ha/client.ts:5-8`). Deliberately a **second, independent** HA WS connection from the existing `ha/` client's `state_changed` subscription, so a long voice interaction can never block or delay reactive entity-cache updates. Reuses the same `HA_URL`/`HA_TOKEN` env config as `ha/`.
- `relay.ts` — pure-ish orchestration: given a display's `pipelineId` and an incoming audio stream, calls `assist_pipeline/run` with `start_stage: 'stt'`, streams binary chunks per HA's `stt_binary_handler_id` protocol, and re-emits `stt-end`/`intent-end`/`tts-end` events.
- `pipelines.ts` — thin wrapper to list HA's configured Assist pipelines (for the admin dropdown), backing a new `GET /api/ha/assist-pipelines` route added alongside existing routes in `server/src/api/` (pattern matches existing `GET /api/ha/entities`).

### WS hub dispatch (`server/src/api/ws.ts`)
`attachWsHub` (`ws.ts:97`) gains a case for inbound `voice_audio`/`voice_health` messages, dispatching into `voice/relay.ts`, and a `pushVoiceResultTo(displayId, result)` helper alongside the existing `pushOverlayTo`/`dismissOverlayFor` (`ws.ts:68-71`). No existing message handling branches change.

### Data model
One migration (next sequential version in `server/src/store/migrations.ts`, following the `orientation` column precedent at version 5):
```sql
ALTER TABLE displays ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE displays ADD COLUMN voice_pipeline_id TEXT;
```
Additive, defaulted, nullable — existing rows and code paths unaffected.

### Admin UI (`display/src/routes/admin/displays/+page.svelte`)
New fieldset in the existing per-row expand panel (alongside the orientation `<select>` at `+page.svelte:211-241`): a toggle for `voice_enabled`, a `<select>` populated from `GET /api/ha/assist-pipelines` for `voice_pipeline_id`, and a read-only status line (`mic: ok` / `mic: unavailable` / `mic: error — <reason>`) sourced from the display's last-reported `voice_health` ping. Wiring follows the existing `api.displays.setOrientation` pattern (`admin/api.ts:62`) — add `api.displays.setVoice(displayId, { enabled, pipelineId })`.

## Data flow / message shapes

**Client → server**
```ts
{ type: 'voice_audio', seq: number, chunk: string /* base64 PCM16 */, final: boolean }
{ type: 'voice_health', mic: 'ok' | 'permission_denied' | 'model_load_failed' | 'idle' }
```

**Server → client**
```ts
{ type: 'voice_result', stage: 'listening' | 'stt-end' | 'intent-end' | 'tts-end' | 'error', data: { text?: string, audioUrl?: string, error?: string } }
```

**Server → HA** (via dedicated voice HA WS connection)
Standard `assist_pipeline/run` WS command with `start_stage: 'stt'`, `pipeline: <voice_pipeline_id or omitted for HA default>`; binary audio frames prefixed with the handler id HA returns in `stt-start`, per HA's documented protocol.

## Error handling

| Failure | Behavior |
|---|---|
| Mic permission denied in browser | Module stays idle; `voice_health: 'permission_denied'` reported; admin shows `mic: unavailable`. |
| Wake-word model fails to load | Module stays idle; `voice_health: 'model_load_failed'`; admin shows `mic: error`. |
| HA voice WS connection unreachable | Server-side relay reports `voice_result: {stage: 'error'}`; display briefly shows a "voice unavailable" overlay state (transient, not a persistent error banner) then returns to idle; admin Displays page shows `mic: error — HA unreachable`. |
| No pipeline configured on HA / invalid `voice_pipeline_id` | Same as above — surfaced as a relay-level error, not a crash. |
| Utterance capture times out with no speech | Relay/overlay simply returns to idle; no error state. |

## Testing approach

- **Server (`server/`)**: unit tests for `voice/relay.ts` against a mocked HA WS client (mirrors existing `ha/` test mocking patterns) — verify correct `assist_pipeline/run` payload construction, binary chunk framing, and event re-emission for `stt-end`/`intent-end`/`tts-end`/error cases. Migration test verifying additive columns + defaults on existing `displays` rows.
- **Display (`display/`)**: unit tests for `voice/capture.ts` silence/timeout logic and `voice/index.ts` overlay state transitions given mocked `voice_result` messages. Wake-word model loading itself is not unit-tested (real ONNX inference) — covered by a manual smoke test.
- **Manual/integration**: with a real HA instance and a configured Assist pipeline, enable voice on one display in admin, speak the wake word, confirm STT text appears in the overlay and TTS audio plays through kiosk speakers; verify a display with voice disabled is fully unaffected; verify existing scene/overlay/mood behavior is unchanged with voice both enabled and disabled.

## Rollout note

This is a genuinely new capability, not a modification of existing ones — per the architecture above, the only touches to existing files are: (1) an additive union-type extension in `display/src/lib/ws.ts`, (2) an additive migration on `displays`, (3) a new case branch in the WS hub's dispatch, and (4) a new fieldset in the displays admin panel. Nothing existing changes shape or behavior when `voice_enabled` is false (the default).
