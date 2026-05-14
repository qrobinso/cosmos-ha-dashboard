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

  $: cameras = entities.filter((e) => e.entity_id.startsWith('camera.'));
  $: view = str('view', 'auto');
  $: protocol = str('protocol', 'auto');
</script>

<Section label="Source">
  <Field label="Camera entity" hint="Streams via Cosmos's media proxy — no HA token needed in the browser.">
    <EntityPicker
      value={str('entity_id')}
      entities={cameras}
      placeholder="Search cameras…"
      on:change={(e) => set('entity_id', e.detail)}
    />
  </Field>
  <div class="row">
    <Field label="View" hint="Auto polls a still snapshot; Live streams MJPEG continuously.">
      <select value={view} on:change={(e) => set('view', e.currentTarget.value)}>
        <option value="auto">Auto (snapshot)</option>
        <option value="live">Live</option>
      </select>
    </Field>
    {#if view === 'live'}
      <Field label="Live protocol" hint="Auto prefers WebRTC, then HLS, then MJPEG.">
        <select value={protocol} on:change={(e) => set('protocol', e.currentTarget.value)}>
          <option value="auto">Auto</option>
          <option value="webrtc">WebRTC</option>
          <option value="hls">HLS</option>
          <option value="mjpeg">MJPEG</option>
        </select>
      </Field>
    {/if}
    {#if view === 'auto'}
      <Field label="Refresh (s)" hint="How often to refetch the snapshot">
        <input type="number" min="1" max="3600" value={typeof config.refresh_interval_s === 'number' ? config.refresh_interval_s : 10} on:input={(e) => set('refresh_interval_s', Math.max(1, Number(e.currentTarget.value) || 10))} />
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
      <input type="checkbox" checked={config.show_name === true} on:change={(e) => set('show_name', e.currentTarget.checked)} />
      <span>Show name overlay</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_state === true} on:change={(e) => set('show_state', e.currentTarget.checked)} />
      <span>Show state badge (idle / recording / streaming)</span>
    </label>
  </div>
</Section>

<Section label="Style">
  <div class="row">
    <Field label="Fit">
      <select value={str('fit', 'cover')} on:change={(e) => set('fit', e.currentTarget.value)}>
        <option value="cover">Cover (crop to fill)</option>
        <option value="contain">Contain (letterbox)</option>
        <option value="fill">Fill (stretch)</option>
      </select>
    </Field>
    <Field label="Aspect ratio" hint="e.g. 16:9, 4:3 — blank to fill the cell">
      <input type="text" placeholder="(none)" value={str('aspect_ratio')} on:input={(e) => set('aspect_ratio', e.currentTarget.value)} />
    </Field>
  </div>
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
