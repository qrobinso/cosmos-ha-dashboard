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

  $: numericEntities = entities.filter(
    (e) =>
      e.entity_id.startsWith('sensor.') ||
      e.entity_id.startsWith('input_number.') ||
      e.entity_id.startsWith('counter.'),
  );
</script>

<Section label="Source">
  <Field label="Sensor entity" hint="Numeric entities only (sensors, input_numbers, counters).">
    <EntityPicker
      value={str('entity_id')}
      entities={numericEntities}
      placeholder="Search sensors…"
      on:change={(e) => set('entity_id', e.detail)}
    />
  </Field>
  <Field label="History window">
    <select value={String(config.hours_back ?? 24)} on:change={(e) => set('hours_back', Number(e.currentTarget.value))}>
      <option value="1">Last hour</option>
      <option value="6">Last 6 hours</option>
      <option value="12">Last 12 hours</option>
      <option value="24">Last 24 hours</option>
      <option value="48">Last 2 days</option>
      <option value="168">Last 7 days</option>
    </select>
  </Field>
</Section>

<Section label="Content">
  <Field label="Custom title">
    <input type="text" placeholder="(uses entity friendly name)" value={str('title')} on:input={(e) => set('title', e.currentTarget.value)} />
  </Field>
  <div class="checks">
    <label class="check-row">
      <input type="checkbox" checked={config.show_current !== false} on:change={(e) => set('show_current', e.currentTarget.checked)} />
      <span>Show current value</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_min_max !== false} on:change={(e) => set('show_min_max', e.currentTarget.checked)} />
      <span>Show min &amp; max for the period</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_unit !== false} on:change={(e) => set('show_unit', e.currentTarget.checked)} />
      <span>Show unit of measurement</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_axis === true} on:change={(e) => set('show_axis', e.currentTarget.checked)} />
      <span>Show chart axes</span>
    </label>
  </div>
</Section>

<Section label="Style">
  <div class="row">
    <Field label="Chart type">
      <select value={str('chart_type', 'line')} on:change={(e) => set('chart_type', e.currentTarget.value)}>
        <option value="line">Line</option>
        <option value="bar">Bar</option>
      </select>
    </Field>
    <Field label="Line color">
      <input type="color" value={str('color') || '#f3a26a'} on:input={(e) => set('color', e.currentTarget.value)} />
    </Field>
  </div>
  <div class="checks">
    <label class="check-row">
      <input type="checkbox" checked={config.show_area_fill !== false} on:change={(e) => set('show_area_fill', e.currentTarget.checked)} />
      <span>Fill area under the line</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.smoothing !== false} on:change={(e) => set('smoothing', e.currentTarget.checked)} />
      <span>Smooth the line (Bézier curves)</span>
    </label>
  </div>
</Section>

<style>
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 0.75rem;
    align-items: end;
  }
  .checks {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
</style>
