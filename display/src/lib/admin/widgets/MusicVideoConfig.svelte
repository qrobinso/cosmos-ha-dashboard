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

  $: mediaPlayers = entities.filter((e) => e.entity_id.startsWith('media_player.'));
</script>

<Section label="Source">
  <Field label="Media player" hint="Resolves the YouTube video for whatever this player is currently playing.">
    <EntityPicker
      value={str('entity_id')}
      entities={mediaPlayers}
      placeholder="Search media players…"
      on:change={(e) => set('entity_id', e.detail)}
    />
  </Field>
  <Field label="Search suffix" hint={'Appended to "artist title" when searching YouTube.'}>
    <input
      type="text"
      placeholder="official music video"
      value={str('query_suffix')}
      on:input={(e) => set('query_suffix', e.currentTarget.value)}
    />
  </Field>
</Section>

<Section label="Content">
  <Field label="Name override">
    <input type="text" placeholder="(use entity friendly name)" value={str('name')} on:input={(e) => set('name', e.currentTarget.value)} />
  </Field>
</Section>
