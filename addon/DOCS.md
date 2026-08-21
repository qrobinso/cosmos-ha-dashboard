# Cosmos

A beautiful wall dashboard for Home Assistant. Configure scenes, widgets, transitions, and triggers from inside HA, then point any tablet at Cosmos to use it as a kiosk display.

> Home Assistant renamed "add-ons" to "apps" in 2026. The instructions below use the current terminology; older HA versions called them add-ons.

## Installation

1. Install this app. The Cosmos sidebar panel appears in HA after install.
2. **(Optional but recommended)** Install the **Mosquitto broker** app. Cosmos auto-discovers it via Supervisor and uses it for the message-overlay command topics. Without MQTT, you can still use scenes/widgets/transitions, but `cosmos/<display>/message/set` automations won't work.
3. Open the **Cosmos** sidebar panel and create your first scene.

## Connecting a tablet

Find your HA host's LAN IP. On the tablet's browser, open `http://<HA_IP>:8099/`. The first time, you'll be asked to name the display (e.g. "Living Room"). After that the tablet auto-connects.

## Use Cosmos in HA automations

Cosmos publishes MQTT discovery payloads, so each display shows up as a HA **device** with five entities you can drop straight into automations — no MQTT-publish boilerplate required:

| Entity                                    | Type           | Use in automations                                   |
|-------------------------------------------|----------------|------------------------------------------------------|
| `select.<display>_active_scene`           | Select         | **Action: Select option** → pick a scene to switch.  |
| `notify.<display>_show_message`           | Notify service | **Action: Notification** → push a banner with title + message. |
| `button.<display>_dismiss_message`        | Button         | **Action: Press button** → clear any visible banner. |
| `button.<display>_last_scene`             | Button         | **Action: Press button** → switch back to the previously-active scene. |
| `sensor.<display>_scene`                  | Sensor         | Trigger / condition on the current scene name.       |
| `binary_sensor.<display>_online`          | Connectivity   | Trigger / condition on display online state.         |

Example automation: switch the Kitchen display to a "Cooking" scene when the oven turns on:

```yaml
trigger:
  platform: state
  entity_id: switch.oven
  to: 'on'
action:
  service: select.select_option
  target:
    entity_id: select.kitchen_active_scene
  data:
    option: Cooking
```

### Direct MQTT (advanced)

If you'd rather skip the discovery entities, the raw command topics still work:

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

| Option           | Description                                                                                                                              | Default  |
|------------------|------------------------------------------------------------------------------------------------------------------------------------------|----------|
| `log_level`      | Server log verbosity (`trace` / `debug` / `info` / `notice` / `warning` / `error` / `fatal`).                                            | `info`   |
| `mqtt_host`      | MQTT broker hostname or IP. **Leave blank** to auto-discover the bundled Mosquitto broker app via Supervisor. Fill it in to override.    | *empty*  |
| `mqtt_port`      | MQTT broker port. Used only when `mqtt_host` is set.                                                                                     | `1883`   |
| `mqtt_username`  | MQTT username. Used only when `mqtt_host` is set. Leave blank for anonymous brokers.                                                     | *empty*  |
| `mqtt_password`  | MQTT password. Used only when `mqtt_host` is set.                                                                                        | *empty*  |
| `mqtt_use_ssl`   | Connect with TLS (`mqtts://`). Leave off for the standard local-network broker.                                                          | `false`  |
| `log_musicvideo` | Trace the video backdrop widget: candidates considered, how each scored, and why nothing plays when nothing does. Errors log regardless.     | `false`  |

If `mqtt_host` is left blank, Cosmos transparently uses the broker exposed by Home Assistant's Mosquitto app (no further setup needed). The manual fields take precedence when filled in.

## Persistence

All scenes, displays, transitions, and settings live in `/data/cosmos.db` inside the app. HA persists `/data` across app restarts and updates.

## Canvas widget

The canvas widget runs sandboxed HTML/CSS/JS authored by you or an LLM agent. Templates inside the content (`{{ states("sensor.foo") }}`) are rendered by Home Assistant — full HA Jinja compatibility. The iframe gets a read-only `cosmos` JS bridge for live entity subscriptions.

See [`docs/canvas-widget.md`](https://github.com/qrobinso/cosmos-ha-dashboard/blob/main/docs/canvas-widget.md) for the full guide and [`docs/canvas-widget-agent.md`](https://github.com/qrobinso/cosmos-ha-dashboard/blob/main/docs/canvas-widget-agent.md) for the agent contract.

Recommended: one canvas per scene. Multiple sandboxed iframes on a tablet running 24/7 are measurably expensive on memory + CPU.

## Video backdrop widget

**Videos are stored locally.** The first time a song plays, Cosmos streams it and downloads a copy in the background; every later play comes off your own disk, so YouTube is only ever contacted once per video. Set the size limit on the **Video Backdrop** page — when it fills, the least-played videos are removed first, oldest of those first. Set it to 0 to store nothing and stream every time. Files live in `/share/cosmos/video-cache`, kept out of add-on backups so your snapshots stay small.


Point it at a `media_player` and it plays the official YouTube video for whatever is playing — muted, synced to the track's position, in whatever grid slot you give it. Audio keeps coming from your Home Assistant speaker; the video is just the visual. `yt-dlp` is bundled in this app, so there is nothing to install.

**It shows nothing more often than you might expect, and that is deliberate.** A video plays only when one exists on the artist's own YouTube channel with "official" and "video" in the title. Songs whose real video is titled plainly — Radiohead's "Karma Police", Taylor Swift's "Blank Space" — show nothing rather than risk playing a fan re-upload or a lyric video. TV shows, podcasts, and anything that is not music are skipped entirely.

Settings, in the scene editor's widget inspector:

| Setting | What it does |
|---|---|
| **Media player** | The entity to follow. Required. |
| **Search suffix** | Appended to "artist title" when searching. Default `official music video`; change it when a particular player's metadata needs help. |
| **Opacity** | Fades the video back so it reads as atmosphere rather than the main event. |
| **Edge fade** | Dissolves the edges into the scene instead of ending on a hard rectangle. |
| **Track-change fade** | How gradually the video swaps when the song changes. `0` cuts straight over. |
| **Layer** (under Placement) | `Behind other widgets` turns it into a backdrop the rest of the scene sits on top of. |

For an ambient now-playing wall: size it to the full grid, set Layer to *Behind*, drop opacity to ~40%, add ~140px of edge fade, and put a media player card and a clock on top with their **Transparent background** enabled.

If a widget stays blank and you want to know why, switch on `log_musicvideo` in Configuration — the app log will name the reason, from "no official video" through to the score every candidate received.

**Fixing a specific song.** The **Video Backdrop** page in the sidebar (`/admin/musicvideo`) lets you pin an exact YouTube link to a song, or block a song from ever playing a video — useful for the songs the automatic matcher deliberately skips, or ones you'd just rather not see a video for. A pin or block is permanent until you remove it. See [`docs/video-backdrop-overrides.md`](https://github.com/qrobinso/cosmos-ha-dashboard/blob/main/docs/video-backdrop-overrides.md).

**Updating yt-dlp.** YouTube changes break `yt-dlp` extractors from time to time; a new app release picks up a current version. To patch in place without waiting, run `pip3 install -U --break-system-packages yt-dlp` inside the app container. (`yt-dlp -U` does not work here — that self-updater only applies to yt-dlp's standalone builds, and this app installs it from PyPI.) An in-place update is lost when the app restarts or updates, which is expected.

## Support

Report issues at <https://github.com/qrobinso/cosmos-ha-dashboard>.
