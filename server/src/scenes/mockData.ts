import type {
  EntityState,
  WeatherData,
  WeatherForecastItem,
  WeatherForecastType,
  CalendarData,
  CalendarEvent,
  MediaPlayerData,
  StatisticsData,
  StatisticsPoint,
} from './types.js';

const MOCK_CONDITIONS = [
  'sunny', 'partlycloudy', 'cloudy', 'rainy', 'partlycloudy',
  'sunny', 'sunny', 'cloudy', 'rainy', 'partlycloudy',
];

function mockDailyForecast(slots: number): WeatherForecastItem[] {
  const out: WeatherForecastItem[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < slots; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i + 1);
    const high = 18 + Math.round(Math.sin(i / 2) * 4);
    const low = high - 7 - (i % 3);
    out.push({
      datetime: d.toISOString(),
      condition: MOCK_CONDITIONS[i % MOCK_CONDITIONS.length],
      temperature: high,
      templow: low,
      precipitation: i % 3 === 0 ? 0 : Math.round(Math.random() * 4 * 10) / 10,
      precipitation_probability: i % 3 === 0 ? 0 : 20 + (i * 13) % 60,
      wind_speed: 8 + (i * 3) % 12,
      humidity: 55 + (i * 7) % 30,
    });
  }
  return out;
}

function mockHourlyForecast(slots: number): WeatherForecastItem[] {
  const out: WeatherForecastItem[] = [];
  const start = new Date();
  start.setMinutes(0, 0, 0);
  for (let i = 0; i < slots; i++) {
    const d = new Date(start.getTime() + (i + 1) * 3600 * 1000);
    const hourOfDay = d.getHours();
    // Daytime warmer than night
    const base = 14 + Math.sin((hourOfDay - 6) / 24 * Math.PI * 2) * 6;
    out.push({
      datetime: d.toISOString(),
      condition: MOCK_CONDITIONS[(hourOfDay + i) % MOCK_CONDITIONS.length],
      temperature: Math.round(base * 10) / 10,
      precipitation_probability: i % 4 === 0 ? 60 : 10 + (i * 7) % 30,
      wind_speed: 6 + (i * 2) % 10,
      humidity: 60 + (i * 5) % 25,
    });
  }
  return out;
}

function mockTwiceDailyForecast(slots: number): WeatherForecastItem[] {
  const out: WeatherForecastItem[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < slots; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + Math.floor(i / 2));
    const isDay = i % 2 === 0;
    d.setHours(isDay ? 12 : 0, 0, 0, 0);
    out.push({
      datetime: d.toISOString(),
      condition: MOCK_CONDITIONS[i % MOCK_CONDITIONS.length],
      temperature: isDay ? 21 + (i % 3) : 12 + (i % 3),
      templow: isDay ? undefined : 10 + (i % 3),
      precipitation_probability: i % 3 === 0 ? 50 : 15,
      is_daytime: isDay,
    });
  }
  return out;
}

export function mockWeather(forecastType: WeatherForecastType, slots = 5): WeatherData {
  const forecast =
    forecastType === 'hourly' ? mockHourlyForecast(slots)
    : forecastType === 'twice_daily' ? mockTwiceDailyForecast(slots)
    : mockDailyForecast(slots);
  return {
    entity_id: 'weather.home',
    friendly_name: 'Home',
    forecast_type: forecastType,
    current: {
      temp: 18,
      unit: 'C',
      condition: 'partlycloudy',
      icon: 'partly-cloudy',
      humidity: 64,
      pressure: 1015,
      wind_speed: 12,
      wind_bearing: 'NW',
      visibility: 16,
      cloud_coverage: 40,
      uv_index: 4,
      apparent_temperature: 16,
      dew_point: 11,
    },
    forecast,
  };
}

/** Default mock — daily, 5 slots. Kept as a const for assembler back-compat. */
export const MOCK_WEATHER: WeatherData = mockWeather('daily', 5);

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
  'camera.front_door': {
    entity_id: 'camera.front_door',
    state: 'idle',
    attributes: { friendly_name: 'Front Door', brand: 'Mock', motion_detection_enabled: true },
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
    sources: [],
  };
}

/* -------------------------- Media Player -------------------------- */

const MEDIA_FIXTURES: Record<string, MediaPlayerData> = {
  'media_player.living_room': {
    entity_id: 'media_player.living_room',
    state: 'playing',
    friendly_name: 'Living Room Speaker',
    title: "Hold On, We're Going Home",
    artist: 'Drake',
    album: 'Nothing Was the Same',
    album_art_url: 'https://upload.wikimedia.org/wikipedia/en/4/42/Drake_-_Nothing_Was_the_Same_cover.png',
    position: 134,
    duration: 228,
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
