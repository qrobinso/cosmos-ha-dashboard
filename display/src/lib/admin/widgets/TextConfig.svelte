<script lang="ts">
  import Field from '$lib/admin/Field.svelte';
  import Section from './Section.svelte';
  import type { EntityState } from '$lib/types';

  export let config: Record<string, unknown>;
  // Accepted for a uniform component contract; text has no entity binding.
  export let entities: EntityState[] = [];
  $: void entities;

  function str(key: string, fallback = ''): string {
    const v = config[key];
    return typeof v === 'string' ? v : fallback;
  }
  function set(key: string, value: unknown) {
    config = { ...config, [key]: value };
  }
</script>

<Section label="Content">
  <Field label="Text">
    <textarea
      rows="4"
      class="text-body"
      placeholder="Type any text. It wraps automatically."
      value={str('content')}
      on:input={(e) => set('content', e.currentTarget.value)}
    ></textarea>
    <span class="hint-line">Line breaks are preserved. Font size scales to fit the widget cell.</span>
  </Field>
</Section>

<Section label="Style">
  <Field label="Alignment">
    <select value={str('align', 'center')} on:change={(e) => set('align', e.currentTarget.value)}>
      <option value="left">Left</option>
      <option value="center">Center</option>
      <option value="right">Right</option>
    </select>
  </Field>
  <Field label="Weight">
    <select value={str('weight', '300')} on:change={(e) => set('weight', e.currentTarget.value)}>
      <option value="200">Thin</option>
      <option value="300">Light</option>
      <option value="400">Regular</option>
      <option value="600">Semibold</option>
      <option value="700">Bold</option>
    </select>
  </Field>
</Section>

<style>
  textarea.text-body {
    resize: vertical;
    min-height: 5rem;
    line-height: 1.4;
  }
  .hint-line {
    font-size: 0.8rem;
    color: var(--c-fg-3);
  }
</style>
