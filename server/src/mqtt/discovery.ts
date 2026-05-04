export const COSMOS_DEVICE_ID = 'cosmos_dashboard';

export type DiscoveryPayload = { topic: string; payload: string; retain: true };

export type DiscoveryDisplay = { id: string; name: string };

const COSMOS_DEVICE = {
  identifiers: [COSMOS_DEVICE_ID],
  name: 'Cosmos',
  manufacturer: 'Cosmos',
  model: 'Wall Dashboard',
};

export function buildDiscoveryPayloads(displays: DiscoveryDisplay[]): DiscoveryPayload[] {
  const out: DiscoveryPayload[] = [];
  for (const d of displays) {
    const sceneCfg = {
      name: `${d.name} Scene`,
      unique_id: `cosmos_${d.id}_current_scene`,
      state_topic: `cosmos/${d.id}/current_scene`,
      device: COSMOS_DEVICE,
    };
    out.push({
      topic: `homeassistant/sensor/cosmos_${d.id}_current_scene/config`,
      payload: JSON.stringify(sceneCfg),
      retain: true,
    });
    const onlineCfg = {
      name: `${d.name} Online`,
      unique_id: `cosmos_${d.id}_online`,
      state_topic: `cosmos/${d.id}/online`,
      payload_on: 'online',
      payload_off: 'offline',
      device_class: 'connectivity',
      device: COSMOS_DEVICE,
    };
    out.push({
      topic: `homeassistant/binary_sensor/cosmos_${d.id}_online/config`,
      payload: JSON.stringify(onlineCfg),
      retain: true,
    });
  }
  return out;
}
