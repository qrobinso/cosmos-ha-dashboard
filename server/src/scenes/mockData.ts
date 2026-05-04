import type { EntityState, WeatherData } from './types.js';

export const MOCK_WEATHER: WeatherData = {
  current: { temp: 18, unit: 'C', condition: 'Partly cloudy', icon: 'partly-cloudy' },
  forecast: [
    { day: 'Mon', high: 21, low: 12, icon: 'sunny' },
    { day: 'Tue', high: 19, low: 11, icon: 'cloudy' },
    { day: 'Wed', high: 17, low: 10, icon: 'rain' },
    { day: 'Thu', high: 20, low: 13, icon: 'partly-cloudy' },
    { day: 'Fri', high: 22, low: 14, icon: 'sunny' },
  ],
};

export const MOCK_ENTITIES: Record<string, EntityState> = {
  'light.living_room': {
    entity_id: 'light.living_room',
    state: 'on',
    attributes: { friendly_name: 'Living Room Light', brightness: 180, rgb_color: [255, 220, 180] },
  },
  'switch.coffee': {
    entity_id: 'switch.coffee',
    state: 'off',
    attributes: { friendly_name: 'Coffee Maker' },
  },
  'sensor.outside_temp': {
    entity_id: 'sensor.outside_temp',
    state: '14.5',
    attributes: { friendly_name: 'Outside Temperature', unit_of_measurement: '°C' },
  },
  'binary_sensor.front_door': {
    entity_id: 'binary_sensor.front_door',
    state: 'off',
    attributes: { friendly_name: 'Front Door', device_class: 'door' },
  },
  'climate.thermostat': {
    entity_id: 'climate.thermostat',
    state: 'heat',
    attributes: { friendly_name: 'Thermostat', current_temperature: 19, temperature: 21 },
  },
  'lock.front_door': {
    entity_id: 'lock.front_door',
    state: 'locked',
    attributes: { friendly_name: 'Front Door Lock' },
  },
  'cover.garage': {
    entity_id: 'cover.garage',
    state: 'closed',
    attributes: { friendly_name: 'Garage Door', current_position: 0 },
  },
};

export function mockEntity(entity_id: string): EntityState {
  return (
    MOCK_ENTITIES[entity_id] ?? {
      entity_id,
      state: 'unknown',
      attributes: { friendly_name: entity_id },
    }
  );
}
