<script lang="ts">
  import type { WidgetState, WeatherData, WeatherForecastItem, WeatherCurrent } from '$lib/types';

  export let widget: WidgetState;

  $: data = widget.data as WeatherData | null;
  $: cfg = widget.config as Record<string, unknown>;

  // ── Display options (mirrors HA's weather-forecast lovelace card) ──
  $: nameOverride = typeof cfg.name === 'string' && cfg.name.trim().length > 0 ? cfg.name.trim() : null;
  $: showCurrent = cfg.show_current !== false;
  $: showForecast = cfg.show_forecast !== false;
  $: showName = cfg.show_name !== false;
  $: forecastSlots = typeof cfg.forecast_slots === 'number' && cfg.forecast_slots > 0 ? cfg.forecast_slots : 5;
  // Multi-select (ordered) list of secondary info attributes.
  // Back-compat: if only the legacy `secondary_info_attribute` (singular)
  // is set, treat it as a single-item list. New scenes use the plural
  // array `secondary_info_attributes` set by the editor.
  $: secondaryAttrs = (() => {
    const raw = (cfg as { secondary_info_attributes?: unknown }).secondary_info_attributes;
    if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string' && s !== '');
    const legacy = cfg.secondary_info_attribute;
    if (typeof legacy === 'string' && legacy !== '') return [legacy];
    return [] as string[];
  })();
  $: temperatureUnit = (cfg.temperature_unit === 'F' || cfg.temperature_unit === 'C')
    ? (cfg.temperature_unit as 'C' | 'F')
    : 'auto';
  $: timeFormat = cfg.time_format === '12h' ? '12h' : '24h';

  // ── Derived display values ──
  $: forecast = (data?.forecast ?? []).slice(0, forecastSlots);
  $: forecastType = data?.forecast_type ?? 'daily';
  $: displayName = nameOverride ?? data?.friendly_name ?? 'Weather';

  function tempIn(value: number, srcUnit: 'C' | 'F'): { v: number; u: 'C' | 'F' } {
    const target = temperatureUnit === 'auto' ? srcUnit : temperatureUnit;
    if (target === srcUnit) return { v: value, u: srcUnit };
    if (srcUnit === 'C') return { v: Math.round(((value * 9) / 5 + 32) * 10) / 10, u: 'F' };
    return { v: Math.round((((value - 32) * 5) / 9) * 10) / 10, u: 'C' };
  }

  function humanCondition(c: string): string {
    return c
      .replace(/-/g, ' ')
      .replace(/_/g, ' ')
      .replace(/^\w/, (m) => m.toUpperCase());
  }

  function fmtTemp(value: number | undefined, srcUnit: 'C' | 'F'): string {
    if (value === undefined) return '—';
    const { v, u } = tempIn(value, srcUnit);
    return `${Math.round(v)}°`;
  }

  function fmtHourly(iso: string): string {
    const d = new Date(iso);
    if (timeFormat === '12h') {
      const h = d.getHours() % 12 || 12;
      const ampm = d.getHours() >= 12 ? 'pm' : 'am';
      return `${h}${ampm}`;
    }
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function fmtDaily(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    if (target.getTime() === today.getTime()) return 'Today';
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }

  function fmtTwiceDaily(item: WeatherForecastItem): string {
    const d = new Date(item.datetime);
    const day = d.toLocaleDateString(undefined, { weekday: 'short' });
    return item.is_daytime === false ? `${day} pm/am` : `${day} day`;
  }

  function forecastLabel(item: WeatherForecastItem): string {
    if (forecastType === 'hourly') return fmtHourly(item.datetime);
    if (forecastType === 'twice_daily') return fmtTwiceDaily(item);
    return fmtDaily(item.datetime);
  }

  // ── HA condition → glyph (kept simple; 12 SVG-friendly states) ──
  type ConditionVisual = { glyph: string; tone: string };
  function conditionVisual(condition: string): ConditionVisual {
    const c = condition.toLowerCase();
    if (c.includes('clear-night') || c === 'night') return { glyph: '◐', tone: '#9ab1d6' };
    if (c.includes('sunny') || c === 'clear') return { glyph: '☀', tone: '#f6c453' };
    if (c.includes('partly')) return { glyph: '⛅', tone: '#dbe2eb' };
    if (c.includes('cloud')) return { glyph: '☁', tone: '#b6bdc7' };
    if (c.includes('rain') || c.includes('pour')) return { glyph: '🌧', tone: '#7eb0d6' };
    if (c.includes('snow')) return { glyph: '❄', tone: '#e0ecf6' };
    if (c.includes('thunder') || c.includes('lightning')) return { glyph: '⛈', tone: '#9c8bd6' };
    if (c.includes('fog') || c.includes('mist')) return { glyph: '☁', tone: '#a4adba' };
    if (c.includes('windy')) return { glyph: '🌬', tone: '#bccfd8' };
    if (c.includes('hail')) return { glyph: '🌨', tone: '#bcd0e3' };
    return { glyph: '◌', tone: '#cbd0d6' };
  }

  // ── Secondary info attribute lookup ──
  type SecondaryRow = { label: string; value: string } | null;

  function todayRange(): { hi: number; lo: number; unit: 'C' | 'F' } | null {
    const cur = data?.current;
    const fc = data?.forecast ?? [];
    if (!cur || fc.length === 0) return null;
    // Daily forecast: first item is "today" with high+low baked in.
    if (forecastType === 'daily' && typeof fc[0].temperature === 'number') {
      const hi = fc[0].temperature;
      const lo = typeof fc[0].templow === 'number' ? fc[0].templow : fc[0].temperature;
      return { hi, lo, unit: cur.unit };
    }
    // Hourly / twice-daily: scan today's items for min+max.
    const todayKey = new Date().toISOString().slice(0, 10);
    let hi = -Infinity;
    let lo = Infinity;
    for (const f of fc) {
      if (!f.datetime.startsWith(todayKey)) continue;
      if (typeof f.temperature === 'number') {
        if (f.temperature > hi) hi = f.temperature;
        if (f.temperature < lo) lo = f.temperature;
      }
      if (typeof f.templow === 'number' && f.templow < lo) lo = f.templow;
    }
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    return { hi, lo, unit: cur.unit };
  }

  const SECONDARY_LABELS: Record<string, string> = {
    temp_range: 'High / Low',
    humidity: 'Humidity',
    pressure: 'Pressure',
    wind_speed: 'Wind',
    wind_bearing: 'Wind dir',
    visibility: 'Visibility',
    cloud_coverage: 'Clouds',
    uv_index: 'UV index',
    apparent_temperature: 'Feels like',
    dew_point: 'Dew point',
  };
  const SECONDARY_UNITS: Record<string, string> = {
    humidity: '%',
    pressure: ' hPa',
    wind_speed: ' km/h',
    visibility: ' km',
    cloud_coverage: '%',
    apparent_temperature: '°',
    dew_point: '°',
  };

  function secondaryRowFor(current: WeatherCurrent | undefined, attr: string): SecondaryRow {
    if (!current || !attr) return null;

    if (attr === 'temp_range') {
      const r = todayRange();
      if (!r) return { label: 'High / Low', value: '—' };
      return {
        label: 'High / Low',
        value: `${fmtTemp(r.hi, r.unit)} / ${fmtTemp(r.lo, r.unit)}`,
      };
    }

    const v = (current as unknown as Record<string, unknown>)[attr];
    // Always render the row when the user picked an attribute, so they
    // see immediately whether their integration is supplying it. Show
    // an em-dash when the value is missing.
    if (v === undefined || v === null) {
      return { label: SECONDARY_LABELS[attr] ?? attr, value: '—' };
    }

    let val: string;
    if (attr === 'apparent_temperature' || attr === 'dew_point') {
      val = fmtTemp(typeof v === 'number' ? v : undefined, current.unit);
    } else if (typeof v === 'number') {
      val = `${Math.round(v * 10) / 10}${SECONDARY_UNITS[attr] ?? ''}`;
    } else {
      val = String(v);
    }
    return { label: SECONDARY_LABELS[attr] ?? attr, value: val };
  }

  /** Resolved secondary rows in the user's chosen order. Skips entries
   *  that come back null (no current data); in practice secondaryRowFor
   *  always returns a row when current is present (em-dash for missing). */
  $: secondaryList = secondaryAttrs
    .map((a) => secondaryRowFor(data?.current, a))
    .filter((r): r is { label: string; value: string } => r !== null);
</script>

{#if data}
  <div class="weather" data-forecast-type={forecastType}>
    {#if showCurrent && data.current}
      <div class="current">
        {#if showName}
          <div class="row"><span class="name">{displayName}</span></div>
        {/if}
        <div class="big-temp">{fmtTemp(data.current.temp, data.current.unit)}<span class="unit">{temperatureUnit === 'auto' ? data.current.unit : temperatureUnit}</span></div>
        <div class="condition">{humanCondition(data.current.condition)}</div>
        {#if secondaryList.length > 0}
          <div class="secondary-list">
            {#each secondaryList as s, i (s.label + i)}
              <div class="secondary"><span>{s.label}</span><strong>{s.value}</strong></div>
            {/each}
          </div>
        {/if}
      </div>
    {:else if secondaryList.length > 0}
      <!-- Current conditions hidden but secondary list still requested:
           render it on its own, no big-temp / condition above it. -->
      <div class="current secondary-only">
        {#if showName}
          <div class="row"><span class="name">{displayName}</span></div>
        {/if}
        <div class="secondary-list standalone">
          {#each secondaryList as s, i (s.label + i)}
            <div class="secondary"><span>{s.label}</span><strong>{s.value}</strong></div>
          {/each}
        </div>
      </div>
    {/if}

    {#if showForecast && forecast.length > 0}
      <div class="forecast" data-count={forecast.length}>
        {#each forecast as f (f.datetime)}
          {@const v = conditionVisual(f.condition)}
          <div class="slot">
            <div class="slot-label">{forecastLabel(f)}</div>
            <div class="slot-glyph" style="color:{v.tone}">{v.glyph}</div>
            <div class="slot-temps">
              <span class="hi">{fmtTemp(f.temperature, data.current.unit)}</span>
              {#if f.templow !== undefined}
                <span class="lo">{fmtTemp(f.templow, data.current.unit)}</span>
              {/if}
            </div>
            {#if f.precipitation_probability !== undefined && f.precipitation_probability > 0}
              <div class="slot-precip">{Math.round(f.precipitation_probability)}%</div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <div class="empty">No weather</div>
{/if}

<style>
  .weather {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    height: 100%;
    padding: 1rem;
    box-sizing: border-box;
    container-type: size;
  }
  .empty { opacity: 0.5; padding: 1rem; }

  .current {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-height: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .name {
    font-size: calc(min(7cqmin, 11cqh) * var(--cosmos-font-scale, 1));
    opacity: 0.7;
    text-transform: capitalize;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .condition-glyph {
    font-size: calc(min(12cqmin, 18cqh) * var(--cosmos-font-scale, 1));
    line-height: 1;
  }
  .big-temp {
    font-size: calc(min(22cqmin, 36cqh) * var(--cosmos-font-scale, 1));
    font-weight: 200;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .big-temp .unit {
    font-size: 0.4em;
    opacity: 0.6;
    margin-left: 0.05em;
    font-weight: 300;
  }
  .condition {
    opacity: 0.75;
    font-size: calc(min(7cqmin, 11cqh) * var(--cosmos-font-scale, 1));
    text-transform: capitalize;
  }
  /* List wrapper. Top divider is on the wrapper so multiple rows don't
   * stack divider lines. */
  .secondary-list {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 0.4rem;
    padding-top: 0.4rem;
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }
  .secondary-list.standalone {
    border-top: none;
    padding-top: 0;
    margin-top: 0;
    gap: 0.35rem;
  }
  .secondary {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: calc(min(6cqmin, 10cqh) * var(--cosmos-font-scale, 1));
  }
  .current.secondary-only .secondary {
    /* When standalone, give the list slightly more room for breathing. */
    font-size: calc(min(7cqmin, 11cqh) * var(--cosmos-font-scale, 1));
  }
  .secondary span { opacity: 0.6; }
  .secondary strong {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .forecast {
    display: grid;
    grid-template-columns: repeat(var(--cols, 5), 1fr);
    gap: 0.5rem;
    margin-top: auto;
  }
  .forecast[data-count='1'] { --cols: 1; }
  .forecast[data-count='2'] { --cols: 2; }
  .forecast[data-count='3'] { --cols: 3; }
  .forecast[data-count='4'] { --cols: 4; }
  .forecast[data-count='5'] { --cols: 5; }
  .forecast[data-count='6'] { --cols: 6; }
  .forecast[data-count='7'] { --cols: 7; }
  .forecast[data-count='8'] { --cols: 4; }       /* wraps to 4×2 */
  .forecast[data-count='9'] { --cols: 3; grid-auto-rows: 1fr; }
  .forecast[data-count='10'] { --cols: 5; }      /* 5×2 */
  .forecast[data-count='12'] { --cols: 6; }      /* 6×2 */

  .slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    font-size: calc(min(5cqmin, 8cqh) * var(--cosmos-font-scale, 1));
    line-height: 1.2;
    overflow: hidden;
  }
  .slot-label {
    opacity: 0.7;
    font-size: 0.95em;
    text-transform: capitalize;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .slot-glyph { font-size: 1.6em; line-height: 1; }
  .slot-temps {
    font-variant-numeric: tabular-nums;
  }
  .slot-temps .lo {
    opacity: 0.55;
    margin-left: 0.3em;
  }
  .slot-precip {
    opacity: 0.55;
    font-size: 0.8em;
  }
</style>
