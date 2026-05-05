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

If `mqtt_host` is left blank, Cosmos transparently uses the broker exposed by Home Assistant's Mosquitto app (no further setup needed). The manual fields take precedence when filled in.

## Persistence

All scenes, displays, transitions, and settings live in `/data/cosmos.db` inside the app. HA persists `/data` across app restarts and updates.

## Support

Report issues at <https://github.com/qrobinso/cosmos-ha-dashboard>.
