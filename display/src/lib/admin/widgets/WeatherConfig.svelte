<script lang="ts">
  import Field from '$lib/admin/Field.svelte';
  import EntityPicker from '$lib/admin/EntityPicker.svelte';
  import Section from './Section.svelte';
  import { configList, moveListItem, addToList, removeFromList } from './listConfig';
  import type { EntityState } from '$lib/types';

  export let config: Record<string, unknown>;
  export let entities: EntityState[] = [];

  /** Available secondary-info rows, in default display order. */
  const WEATHER_SECONDARY_OPTIONS: { id: string; label: string }[] = [
    { id: 'temp_range', label: 'High / Low (today)' },
    { id: 'humidity', label: 'Humidity' },
    { id: 'pressure', label: 'Pressure' },
    { id: 'wind_speed', label: 'Wind speed' },
    { id: 'wind_bearing', label: 'Wind bearing' },
    { id: 'visibility', label: 'Visibility' },
    { id: 'cloud_coverage', label: 'Cloud coverage' },
    { id: 'uv_index', label: 'UV index' },
    { id: 'apparent_temperature', label: 'Feels like' },
    { id: 'dew_point', label: 'Dew point' },
  ];
  function secondaryLabel(id: string): string {
    return WEATHER_SECONDARY_OPTIONS.find((o) => o.id === id)?.label ?? id;
  }

  function str(key: string, fallback = ''): string {
    const v = config[key];
    return typeof v === 'string' ? v : fallback;
  }
  function set(key: string, value: unknown) {
    config = { ...config, [key]: value };
  }

  $: weatherEntities = entities.filter((e) => e.entity_id.startsWith('weather.'));
  $: forecastType = str('forecast_type', 'daily');
  $: selectedSecondary = configList(config, 'secondary_info_attributes', 'secondary_info_attribute');
  $: availableSecondary = WEATHER_SECONDARY_OPTIONS.filter((o) => !selectedSecondary.includes(o.id));
</script>

<Section label="Source">
  <Field label="Weather entity" hint="Falls back to mock data when HA isn't connected.">
    <EntityPicker
      value={str('entity_id')}
      entities={weatherEntities}
      placeholder="Search weather entities…"
      on:change={(e) => set('entity_id', e.detail)}
    />
  </Field>
  <div class="row">
    <Field label="Forecast type">
      <select value={forecastType} on:change={(e) => set('forecast_type', e.currentTarget.value)}>
        <option value="daily">Daily</option>
        <option value="hourly">Hourly</option>
        <option value="twice_daily">Twice daily</option>
      </select>
    </Field>
    <Field label="Forecast slots">
      <input type="number" min="1" max="12" value={config.forecast_slots ?? 5} on:input={(e) => set('forecast_slots', Number(e.currentTarget.value))} />
    </Field>
    {#if forecastType === 'hourly'}
      <Field label="Time format">
        <select value={str('time_format', '24h')} on:change={(e) => set('time_format', e.currentTarget.value)}>
          <option value="24h">24h</option>
          <option value="12h">12h</option>
        </select>
      </Field>
    {/if}
  </div>
</Section>

<Section label="Content">
  <Field label="Name override">
    <input type="text" placeholder="(use entity friendly name)" value={str('name')} on:input={(e) => set('name', e.currentTarget.value)} />
  </Field>
  <div class="checks">
    <label class="check-row">
      <input type="checkbox" checked={config.show_current !== false} on:change={(e) => set('show_current', e.currentTarget.checked)} />
      <span>Show current conditions</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_forecast !== false} on:change={(e) => set('show_forecast', e.currentTarget.checked)} />
      <span>Show forecast</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_name !== false} on:change={(e) => set('show_name', e.currentTarget.checked)} />
      <span>Show name</span>
    </label>
  </div>
  <Field label="Secondary info">
    <span class="hint-line">Pick any number of stats to show under the current conditions, in priority order.</span>
    <div class="pickers">
      <div class="picker-col">
        <h5>Available</h5>
        {#if availableSecondary.length === 0}
          <p class="hint-line">All options selected.</p>
        {:else}
          <ul class="picker-list">
            {#each availableSecondary as o (o.id)}
              <li><button type="button" class="add-btn" on:click={() => (config = addToList(config, 'secondary_info_attributes', o.id))}>+ {o.label}</button></li>
            {/each}
          </ul>
        {/if}
      </div>
      <div class="picker-col">
        <h5>Showing (priority order)</h5>
        {#if selectedSecondary.length === 0}
          <p class="hint-line">Add rows from the left.</p>
        {:else}
          <ol class="picker-list ordered">
            {#each selectedSecondary as id, k (id)}
              <li>
                <span class="seq">{k + 1}.</span>
                <span class="name">{secondaryLabel(id)}</span>
                <button type="button" class="mini" on:click={() => (config = moveListItem(config, 'secondary_info_attributes', k, -1))} disabled={k === 0} aria-label="Move up">↑</button>
                <button type="button" class="mini danger" on:click={() => (config = removeFromList(config, 'secondary_info_attributes', id))} aria-label="Remove">×</button>
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    </div>
  </Field>
</Section>

<Section label="Style">
  <Field label="Temperature unit">
    <select value={str('temperature_unit', 'auto')} on:change={(e) => set('temperature_unit', e.currentTarget.value)}>
      <option value="auto">Auto (entity)</option>
      <option value="C">Celsius</option>
      <option value="F">Fahrenheit</option>
    </select>
  </Field>
</Section>

<style>
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 0.75rem;
  }
  .checks {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .hint-line {
    font-size: 0.8rem;
    color: var(--c-fg-3);
  }
  .pickers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-top: 0.35rem;
  }
  @media (max-width: 540px) {
    .pickers { grid-template-columns: 1fr; }
  }
  .picker-col h5 {
    margin: 0 0 0.4rem;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--c-fg-3);
    font-weight: 600;
  }
  .picker-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .picker-list.ordered li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--c-surface-2);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0.3rem 0.5rem;
  }
  .picker-list .seq { color: var(--c-fg-3); font-size: 0.78rem; min-width: 1.3rem; }
  .picker-list .name { flex: 1; font-size: 0.85rem; }
  .add-btn {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px dashed var(--c-line-strong);
    color: var(--c-fg-2);
    padding: 0.35rem 0.55rem;
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    min-height: 0;
    cursor: pointer;
  }
  .add-btn:hover { background: var(--c-surface-2); color: var(--c-fg); }
  button.mini {
    padding: 0.1rem 0.4rem;
    min-height: 0;
    font-size: 0.85rem;
    background: transparent;
    border: 1px solid var(--c-line);
    color: var(--c-fg-2);
    border-radius: var(--r-1);
    cursor: pointer;
  }
  button.mini.danger { color: var(--c-danger); border-color: var(--c-danger-tint); }
  button.mini:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
