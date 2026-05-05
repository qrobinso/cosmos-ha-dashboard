export const COSMOS_DEVICE_ID = 'cosmos_dashboard';

export type DiscoveryPayload = { topic: string; payload: string; retain: true };

export type DiscoveryDisplay = { id: string; name: string };

const COSMOS_DEVICE = {
  identifiers: [COSMOS_DEVICE_ID],
  name: 'Cosmos',
  manufacturer: 'Cosmos',
  model: 'Wall Dashboard',
};

/**
 * Publish HA MQTT discovery payloads so each display gets a Cosmos
 * "device" with read-only entities (current scene, online status) AND
 * commandable entities that show up as automation actions:
 *
 *   - notify.cosmos_<display>_show_message   — push a banner
 *   - button.cosmos_<display>_dismiss_message — clear the banner
 *   - select.cosmos_<display>_active_scene    — switch the active scene
 *
 * Scene names must be passed in so the select's `options` list matches
 * the configured scenes; republish on scene CRUD to keep them in sync.
 */
export function buildDiscoveryPayloads(
  displays: DiscoveryDisplay[],
  sceneNames: string[] = []
): DiscoveryPayload[] {
  const out: DiscoveryPayload[] = [];
  for (const d of displays) {
    // ── Read-only sensors ────────────────────────────────────────────
    out.push({
      topic: `homeassistant/sensor/cosmos_${d.id}_current_scene/config`,
      payload: JSON.stringify({
        name: `${d.name} Scene`,
        unique_id: `cosmos_${d.id}_current_scene`,
        state_topic: `cosmos/${d.id}/current_scene`,
        device: COSMOS_DEVICE,
      }),
      retain: true,
    });
    out.push({
      topic: `homeassistant/binary_sensor/cosmos_${d.id}_online/config`,
      payload: JSON.stringify({
        name: `${d.name} Online`,
        unique_id: `cosmos_${d.id}_online`,
        state_topic: `cosmos/${d.id}/online`,
        payload_on: 'online',
        payload_off: 'offline',
        device_class: 'connectivity',
        device: COSMOS_DEVICE,
      }),
      retain: true,
    });

    // ── Notify: notify.cosmos_<display>_show_message ─────────────────
    // HA passes `message` (as `value`) and optional `title` to the
    // command_template. We wrap them into the JSON payload Cosmos's
    // mqtt/commands.ts parser expects.
    out.push({
      topic: `homeassistant/notify/cosmos_${d.id}_show_message/config`,
      payload: JSON.stringify({
        name: `${d.name} Show Message`,
        unique_id: `cosmos_${d.id}_show_message`,
        command_topic: `cosmos/${d.id}/message/set`,
        command_template:
          "{\"title\": {{ title | default('Cosmos') | to_json }}, \"body\": {{ value | to_json }}}",
        device: COSMOS_DEVICE,
      }),
      retain: true,
    });

    // ── Button: dismiss any visible message ──────────────────────────
    out.push({
      topic: `homeassistant/button/cosmos_${d.id}_dismiss_message/config`,
      payload: JSON.stringify({
        name: `${d.name} Dismiss Message`,
        unique_id: `cosmos_${d.id}_dismiss_message`,
        command_topic: `cosmos/${d.id}/message/dismiss`,
        payload_press: '',
        device: COSMOS_DEVICE,
      }),
      retain: true,
    });

    // ── Select: choose the active scene ──────────────────────────────
    // The state_topic publishes the active scene name, which is exactly
    // the option the select should show as selected.
    out.push({
      topic: `homeassistant/select/cosmos_${d.id}_active_scene/config`,
      payload: JSON.stringify({
        name: `${d.name} Active Scene`,
        unique_id: `cosmos_${d.id}_active_scene`,
        command_topic: `cosmos/${d.id}/scene/set`,
        command_template: '{"scene_name": {{ value | to_json }}}',
        options: sceneNames,
        state_topic: `cosmos/${d.id}/current_scene`,
        device: COSMOS_DEVICE,
      }),
      retain: true,
    });
  }
  return out;
}
