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
  <Field label="Media player entity">
    <EntityPicker
      value={str('entity_id')}
      entities={mediaPlayers}
      placeholder="Search media players…"
      on:change={(e) => set('entity_id', e.detail)}
    />
  </Field>
</Section>

<Section label="Content">
  <div class="checks">
    <label class="check-row">
      <input type="checkbox" checked={config.show_album_art !== false} on:change={(e) => set('show_album_art', e.currentTarget.checked)} />
      <span>Show album art</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_title !== false} on:change={(e) => set('show_title', e.currentTarget.checked)} />
      <span>Show title</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_artist !== false} on:change={(e) => set('show_artist', e.currentTarget.checked)} />
      <span>Show artist</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_album === true} on:change={(e) => set('show_album', e.currentTarget.checked)} />
      <span>Show album name</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_progress !== false} on:change={(e) => set('show_progress', e.currentTarget.checked)} />
      <span>Show progress bar &amp; times</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_controls !== false} on:change={(e) => set('show_controls', e.currentTarget.checked)} />
      <span>Show transport controls (play/next/prev)</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_volume === true} on:change={(e) => set('show_volume', e.currentTarget.checked)} />
      <span>Show volume</span>
    </label>
    <label class="check-row">
      <input type="checkbox" checked={config.show_source === true} on:change={(e) => set('show_source', e.currentTarget.checked)} />
      <span>Show source / app name (Spotify, Plex, …)</span>
    </label>
  </div>
</Section>

<Section label="Style">
  <Field label="Theme" hint="Visual style for the player">
    <select value={str('theme', 'default')} on:change={(e) => set('theme', e.currentTarget.value)}>
      <option value="default">Default — horizontal art + info</option>
      <option value="cinematic">Cinematic — full-bleed art with overlay</option>
      <option value="card">Card — bold vertical layout</option>
      <option value="vinyl">Vinyl — sleeve with spinning record</option>
    </select>
  </Field>
  <label class="check-row">
    <input type="checkbox" checked={config.blur_background !== false} on:change={(e) => set('blur_background', e.currentTarget.checked)} />
    <span>Blur album art behind the widget</span>
  </label>
  <label class="check-row">
    <input type="checkbox" checked={config.compact === true} on:change={(e) => set('compact', e.currentTarget.checked)} />
    <span>Compact layout (smaller art, denser text)</span>
  </label>
</Section>

<style>
  .checks {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
</style>
