<script lang="ts">
  import Field from '$lib/admin/Field.svelte';
  import EntityPicker from '$lib/admin/EntityPicker.svelte';
  import Section from './Section.svelte';
  import { CALENDAR_SOURCE_PALETTE } from './calendarPalette';
  import type { EntityState } from '$lib/types';

  export let config: Record<string, unknown>;
  export let entities: EntityState[] = [];

  const PALETTE = CALENDAR_SOURCE_PALETTE;

  type Source = { id: string; entity_id: string; label: string; color: string };

  function str(key: string, fallback = ''): string {
    const v = config[key];
    return typeof v === 'string' ? v : fallback;
  }
  function set(key: string, value: unknown) {
    config = { ...config, [key]: value };
  }

  function readSources(c: Record<string, unknown>): Source[] {
    if (Array.isArray(c.sources)) {
      return (c.sources as Array<Record<string, unknown>>)
        .filter((s) => typeof s.entity_id === 'string' && s.entity_id)
        .map((s, i) => ({
          id: typeof s.id === 'string' && s.id ? s.id : (s.entity_id as string),
          entity_id: s.entity_id as string,
          label:
            typeof s.label === 'string' && s.label
              ? (s.label as string)
              : (s.entity_id as string).replace(/^calendar\./, '').replace(/_/g, ' '),
          color: typeof s.color === 'string' ? (s.color as string) : PALETTE[i % PALETTE.length],
        }));
    }
    if (typeof c.entity_id === 'string' && c.entity_id) {
      return [
        {
          id: c.entity_id,
          entity_id: c.entity_id,
          label: c.entity_id.replace(/^calendar\./, '').replace(/_/g, ' '),
          color: PALETTE[0],
        },
      ];
    }
    return [];
  }

  $: calendarEntities = entities.filter((e) => e.entity_id.startsWith('calendar.'));
  $: sources = readSources(config);
  $: view = (typeof config.view === 'string' ? config.view : 'agenda') as
    | 'agenda'
    | 'month'
    | 'week'
    | 'day'
    | 'lanes';

  function commitSources(next: Source[]) {
    let updated: Record<string, unknown> = { ...config, sources: next };
    if ('entity_id' in updated) {
      const { entity_id, ...rest } = updated;
      updated = rest;
    }
    config = updated;
  }

  function updateSource(i: number, patch: Partial<Source>) {
    const next = sources.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    commitSources(next);
  }
  function addSource() {
    const next: Source = {
      id: `src-${Date.now()}`,
      entity_id: '',
      label: 'New calendar',
      color: PALETTE[sources.length % PALETTE.length],
    };
    commitSources([...sources, next]);
  }
  function removeSource(i: number) {
    commitSources(sources.filter((_, idx) => idx !== i));
  }
</script>

<Section label="Source">
  <Field label="View">
    <select value={view} on:change={(e) => set('view', e.currentTarget.value)}>
      <option value="agenda">Agenda (list)</option>
      <option value="month">Month grid</option>
      <option value="week">Week (time grid)</option>
      <option value="day">Day (time grid)</option>
      <option value="lanes">Lanes (one column per calendar)</option>
    </select>
  </Field>

  <Field label="Calendars">
    {#each sources as src, i (src.id)}
      <div class="src-row">
        <input
          type="color"
          value={src.color}
          on:change={(e) => updateSource(i, { color: e.currentTarget.value })}
          aria-label="Color for {src.label}"
        />
        <EntityPicker
          value={src.entity_id}
          entities={calendarEntities}
          placeholder="Search calendars…"
          on:change={(e) => updateSource(i, { entity_id: e.detail, id: e.detail || src.id })}
        />
        <input
          class="lbl"
          value={src.label}
          placeholder="Label"
          aria-label="Label for {src.label}"
          on:change={(e) => updateSource(i, { label: e.currentTarget.value })}
        />
        <button type="button" class="remove" on:click={() => removeSource(i)} aria-label="Remove">×</button>
      </div>
    {/each}
    <button type="button" class="add" on:click={addSource}>+ Add calendar</button>
  </Field>

  <div class="row">
    <Field label="Days ahead">
      <select value={String(config.days_ahead ?? 7)} on:change={(e) => set('days_ahead', Number(e.currentTarget.value))}>
        <option value="1">Today only</option>
        <option value="2">Today + tomorrow</option>
        <option value="3">3 days</option>
        <option value="7">1 week</option>
        <option value="14">2 weeks</option>
        <option value="30">1 month</option>
      </select>
    </Field>
    {#if view === 'agenda'}
      <Field label="Max events">
        <input type="number" min="1" max="50" value={config.max_events ?? 8} on:input={(e) => set('max_events', Number(e.currentTarget.value))} />
      </Field>
    {/if}
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
  .src-row {
    display: grid;
    grid-template-columns: 2.5rem 1fr 8rem 2rem;
    gap: 0.4rem;
    align-items: center;
    margin-bottom: 0.35rem;
  }
  .src-row .lbl {
    font-size: 0.85rem;
  }
  .src-row .remove {
    background: transparent;
    border: 1px solid var(--c-line);
    color: var(--c-fg-2);
    border-radius: 0.3rem;
    cursor: pointer;
  }
  .add {
    background: transparent;
    border: 1px dashed var(--c-line);
    color: var(--c-fg-2);
    padding: 0.4rem 0.6rem;
    border-radius: 0.3rem;
    cursor: pointer;
    width: 100%;
    margin-top: 0.3rem;
  }
</style>
