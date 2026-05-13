<script lang="ts">
  import Field from '$lib/admin/Field.svelte';
  import Section from './Section.svelte';
  import type { EntityState } from '$lib/types';

  export let config: Record<string, unknown>;
  // Accepted for a uniform component contract; clock has no entity binding.
  export let entities: EntityState[] = [];
  $: void entities;

  const FONT_FAMILIES = ['Inter', 'Fraunces', 'JetBrains Mono', 'Space Grotesk'];

  function str(key: string, fallback = ''): string {
    const v = config[key];
    return typeof v === 'string' ? v : fallback;
  }
  function set(key: string, value: unknown) {
    config = { ...config, [key]: value };
  }

  $: format = str('format', '24h');
</script>

<Section label="Content">
  <Field label="Format">
    <select value={format} on:change={(e) => set('format', e.currentTarget.value)}>
      <option value="24h">24h</option>
      <option value="12h">12h</option>
    </select>
  </Field>
  <Field label="Show seconds">
    <label class="check-row">
      <input type="checkbox" checked={config.show_seconds === true} on:change={(e) => set('show_seconds', e.currentTarget.checked)} />
      <span>Display seconds (ticks every second)</span>
    </label>
  </Field>
  {#if format === '12h'}
    <Field label="Show AM/PM">
      <label class="check-row">
        <input type="checkbox" checked={config.show_ampm !== false} on:change={(e) => set('show_ampm', e.currentTarget.checked)} />
        <span>Append AM or PM after the time</span>
      </label>
    </Field>
  {/if}
  <Field label="Show date">
    <label class="check-row">
      <input type="checkbox" checked={config.show_date !== false} on:change={(e) => set('show_date', e.currentTarget.checked)} />
      <span>Display the date below the time</span>
    </label>
  </Field>
</Section>

<Section label="Style">
  <Field label="Font (override)" hint="Overrides the scene font for this clock only.">
    <select value={str('font_family')} on:change={(e) => set('font_family', e.currentTarget.value)}>
      <option value="">— Use scene font —</option>
      {#each FONT_FAMILIES as f (f)}<option value={f}>{f}</option>{/each}
    </select>
  </Field>
  <Field label="Weight (override)">
    <select value={str('font_weight')} on:change={(e) => set('font_weight', e.currentTarget.value)}>
      <option value="">— Default —</option>
      <option value="100">100 · Thin</option>
      <option value="200">200 · ExtraLight</option>
      <option value="300">300 · Light</option>
      <option value="400">400 · Regular</option>
      <option value="500">500 · Medium</option>
      <option value="600">600 · Semibold</option>
      <option value="700">700 · Bold</option>
      <option value="800">800 · Extrabold</option>
      <option value="900">900 · Black</option>
    </select>
  </Field>
</Section>
