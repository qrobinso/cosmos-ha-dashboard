# Cosmos

A beautiful wall dashboard for Home Assistant. Configure scenes, widgets, transitions, and triggers from inside HA, then point any tablet at Cosmos to use it as a kiosk display.

## Installation

1. Install this add-on. The Cosmos sidebar panel appears in HA after install.
2. **(Optional but recommended)** Install the **Mosquitto broker** add-on. Cosmos auto-discovers it via Supervisor and uses it for the message-overlay command topics. Without MQTT, you can still use scenes/widgets/transitions, but `cosmos/<display>/message/set` automations won't work.
3. Open the **Cosmos** sidebar panel and create your first scene.

## Connecting a tablet

Find your HA host's LAN IP. On the tablet's browser, open `http://<HA_IP>:8099/`. The first time, you'll be asked to name the display (e.g. "Living Room"). After that the tablet auto-connects.

## Configuration via HA automations

The MQTT command topics work out-of-the-box once the Mosquitto add-on is running:

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

| Option       | Description                                   | Default |
|--------------|-----------------------------------------------|---------|
| `log_level`  | Server log verbosity                          | `info`  |

## Persistence

All scenes, displays, transitions, and settings live in `/data/cosmos.db` inside the add-on. HA persists `/data` across add-on restarts and updates.

## Support

Report issues at <https://github.com/qrobinso/cosmos-dashboard>.
