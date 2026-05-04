import type {
  EntityState,
  WeatherData,
  CalendarData,
  CalendarEvent,
  MediaPlayerData,
  StatisticsData,
  StatisticsPoint,
} from './types.js';

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
  'input_boolean.guest_mode': {
    entity_id: 'input_boolean.guest_mode',
    state: 'off',
    attributes: { friendly_name: 'Guest Mode' },
  },
  'input_number.target_temp': {
    entity_id: 'input_number.target_temp',
    state: '21',
    attributes: { friendly_name: 'Target Temperature', unit_of_measurement: '°C', min: 10, max: 30 },
  },
  'input_select.house_mode': {
    entity_id: 'input_select.house_mode',
    state: 'home',
    attributes: { friendly_name: 'House Mode', options: ['home', 'away', 'sleep'] },
  },
  'input_text.note': {
    entity_id: 'input_text.note',
    state: 'Welcome home',
    attributes: { friendly_name: 'Display Note' },
  },
  'input_datetime.wakeup': {
    entity_id: 'input_datetime.wakeup',
    state: '07:00:00',
    attributes: { friendly_name: 'Wakeup Time', has_time: true, has_date: false },
  },
  'counter.coffee_count': {
    entity_id: 'counter.coffee_count',
    state: '3',
    attributes: { friendly_name: 'Coffees Today' },
  },
  'timer.laundry': {
    entity_id: 'timer.laundry',
    state: 'idle',
    attributes: { friendly_name: 'Laundry Timer', duration: '00:45:00' },
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

/* -------------------------- Calendar -------------------------- */

function isoOffsetHours(hoursFromNow: number, durationHours = 1): { start: string; end: string } {
  const now = Date.now();
  const start = new Date(now + hoursFromNow * 3_600_000);
  const end = new Date(start.getTime() + durationHours * 3_600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function isoAllDay(daysFromNow: number): { start: string; end: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + daysFromNow);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

const EVENTS: CalendarEvent[] = [
  { summary: 'Morning standup', location: 'Zoom', ...isoOffsetHours(2), all_day: false },
  { summary: 'Lunch with Maya', location: 'Tatte Bakery', ...isoOffsetHours(5), all_day: false, description: 'Try the shakshuka' },
  { summary: 'Pick up dry cleaning', ...isoOffsetHours(8), all_day: false },
  { summary: 'Anniversary 🎉', ...isoAllDay(1), all_day: true },
  { summary: 'Dentist', location: 'Dr. Reed', ...isoOffsetHours(28, 0.75), all_day: false },
  { summary: 'Project deadline', ...isoAllDay(2), all_day: true },
  { summary: 'Yoga class', location: 'Studio B', ...isoOffsetHours(34), all_day: false },
];

export function mockCalendar(entity_id: string): CalendarData {
  return {
    entity_id,
    friendly_name: entity_id.replace(/^calendar\./, '').replace(/_/g, ' ') || 'Calendar',
    events: EVENTS,
  };
}

/* -------------------------- Media Player -------------------------- */

const MEDIA_FIXTURES: Record<string, MediaPlayerData> = {
  'media_player.living_room': {
    entity_id: 'media_player.living_room',
    state: 'playing',
    friendly_name: 'Living Room Speaker',
    title: 'In a Sentimental Mood',
    artist: 'Duke Ellington & John Coltrane',
    album: 'Duke Ellington & John Coltrane',
    album_art_url: 'https://upload.wikimedia.org/wikipedia/en/2/2e/Duke_Ellington_and_John_Coltrane.jpg',
    position: 134,
    duration: 254,
    volume: 0.42,
    muted: false,
    source: 'Spotify',
    app: 'Spotify',
    supports: { play_pause: true, next: true, previous: true, volume_set: true, select_source: true },
  },
  'media_player.kitchen': {
    entity_id: 'media_player.kitchen',
    state: 'paused',
    friendly_name: 'Kitchen Speaker',
    title: 'Pancakes for Dinner',
    artist: 'Lizzy McAlpine',
    album: 'Give Me a Minute',
    position: 22,
    duration: 192,
    volume: 0.3,
    muted: false,
    supports: { play_pause: true, next: true, previous: true },
  },
};

export function mockMediaPlayer(entity_id: string): MediaPlayerData {
  return (
    MEDIA_FIXTURES[entity_id] ?? {
      entity_id,
      state: 'idle',
      friendly_name: entity_id.replace(/^media_player\./, '').replace(/_/g, ' '),
    }
  );
}

/* -------------------------- Statistics / history -------------------------- */

/** Generate a realistic-looking smooth random walk for any entity. */
export function mockHistory(entity_id: string, hoursBack: number): StatisticsData {
  const points: StatisticsPoint[] = [];
  const now = Date.now();
  const samples = 60; // ~one point per (hoursBack/60) hours
  let value = 18 + (entity_id.length % 6); // deterministic-ish baseline per entity
  let min = value;
  let max = value;
  for (let i = samples - 1; i >= 0; i--) {
    const t = now - (i / (samples - 1)) * hoursBack * 3_600_000;
    // smooth wobble: sine + tiny pseudo-random
    const drift = Math.sin((i / samples) * Math.PI * 2 + entity_id.length) * 2.5;
    const wiggle = ((i * 9301 + 49297) % 233280) / 233280 - 0.5;
    value = value + drift * 0.08 + wiggle * 0.6;
    points.push({ t, v: Math.round(value * 100) / 100 });
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const friendly = entity_id.split('.').pop()?.replace(/_/g, ' ') ?? entity_id;
  return {
    entity_id,
    friendly_name: friendly,
    unit: entity_id.includes('temp') ? '°C' : entity_id.includes('humid') ? '%' : entity_id.includes('power') ? 'W' : '',
    current: points[points.length - 1]?.v,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    points,
  };
}
