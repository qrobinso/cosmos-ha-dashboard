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
</script>

<Section label="Source">
  <Field label="Entity" hint="The tile renders with a layout tuned to the entity's domain.">
    <EntityPicker
      value={str('entity_id')}
      {entities}
      placeholder="Search any entity…"
      on:change={(e) => set('entity_id', e.detail)}
    />
  </Field>
</Section>
