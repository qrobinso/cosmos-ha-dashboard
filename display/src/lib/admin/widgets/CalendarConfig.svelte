<script lang="ts">
  import Field from '$lib/admin/Field.svelte';
  import EntityPicker from '$lib/admin/EntityPicker.svelte';
  import Section from './Section.svelte';
  import type { EntityState } from '$lib/types';

  export let config: Record<string, unknown>;
  export let entities: EntityState[] = [];

  function str(key: string, fallback = ''): string {
    const v = config[key];
    return typeof v === 'string' ? v : fallback;
  }
  function set(key: string, value: unknown) {
    config = { ...config, [key]: value };
  }

  $: calendarEntities = entities.filter((e) => e.entity_id.startsWith('calendar.'));
</script>

<Section label="Source">
  <Field label="Calendar entity" hint="Falls back to mock events when HA isn't connected.">
    <EntityPicker
      value={str('entity_id')}
      entities={calendarEntities}
      placeholder="Search calendars…"
      on:change={(e) => set('entity_id', e.detail)}
    />
  </Field>
  <div class="row">
    <Field label="Days ahead">
      <select value={String(config.days_ahead ?? 2)} on:change={(e) => set('days_ahead', Number(e.currentTarget.value))}>
        <option value="1">Today only</option>
        <option value="2">Today + tomorrow</option>
        <option value="3">3 days</option>
        <option value="7">1 week</option>
        <option value="14">2 weeks</option>
        <option value="30">1 month</option>
      </select>
    </Field>
    <Field label="Max events">
      <input type="number" min="1" max="50" value={config.max_events ?? 5} on:input={(e) => set('max_events', Number(e.currentTarget.value))} />
    </Field>
  </div>
</Section>

<Section label="Content">
  <div class="checks">
    <label class="check-row">
      <input type="checkbox" checked={config.show_header !== false} on:change={(e) => set('show_header', e.currentTarget.checked)} />
      <span>Show header (calendar name + count)</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_all_day !== false} on:change={(e) => set('show_all_day', e.currentTarget.checked)} />
      <span>Show all-day events</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_location !== false} on:change={(e) => set('show_location', e.currentTarget.checked)} />
      <span>Show location</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_description === true} on:change={(e) => set('show_description', e.currentTarget.checked)} />
      <span>Show description</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.group_by_day !== false} on:change={(e) => set('group_by_day', e.currentTarget.checked)} />
      <span>Group by day</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.hide_past !== false} on:change={(e) => set('hide_past', e.currentTarget.checked)} />
      <span>Hide past events (today)</span>
    </label>
  </div>
</Section>

<Section label="Style">
  <Field label="Time format">
    <select value={str('time_format', '24h')} on:change={(e) => set('time_format', e.currentTarget.value)}>
      <option value="24h">24h</option>
      <option value="12h">12h</option>
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
</style>
