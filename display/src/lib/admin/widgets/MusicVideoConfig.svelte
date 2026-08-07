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

  // Stored 0..1; edited as a percentage, which is what people think in.
  $: opacity = typeof config.opacity === 'number' ? config.opacity : 1;
  $: opacityPct = Math.round(opacity * 100);
  $: edgeFade = typeof config.edge_fade === 'number' ? config.edge_fade : 0;
  $: fadeMs = typeof config.fade_ms === 'number' ? config.fade_ms : 800;
</script>

<Section label="Source">
  <Field label="Media player" hint="Resolves the official video for whatever this player is currently playing.">
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

<Section label="Style">
  <Field
    label="Opacity"
    hint="Fade the video back so it reads as atmosphere rather than the main event. Pairs well with Layer → Behind other widgets, under Placement."
  >
    <div class="opacity-row">
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={opacityPct}
        on:input={(e) => set('opacity', Number(e.currentTarget.value) / 100)}
      />
      <span class="opacity-val">{opacityPct}%</span>
      {#if opacityPct !== 100}
        <button type="button" class="ghost sm" on:click={() => set('opacity', 1)}>Reset</button>
      {/if}
    </div>
  </Field>

  <Field
    label="Edge fade"
    hint="Dissolves the video into the scene instead of ending on a hard rectangle. Costs nothing at 0 — the mask is only applied when you set one."
  >
    <div class="opacity-row">
      <input
        type="range"
        min="0"
        max="200"
        step="5"
        value={edgeFade}
        on:input={(e) => set('edge_fade', Number(e.currentTarget.value))}
      />
      <span class="opacity-val">{edgeFade ? `${edgeFade}px` : 'off'}</span>
      {#if edgeFade > 0}
        <button type="button" class="ghost sm" on:click={() => set('edge_fade', 0)}>Reset</button>
      {/if}
    </div>
  </Field>

  <Field
    label="Track-change fade"
    hint="How long the video takes to fade out when the track changes, and back in once the next one is ready to play. 0 cuts straight over."
  >
    <div class="opacity-row">
      <input
        type="range"
        min="0"
        max="3000"
        step="100"
        value={fadeMs}
        on:input={(e) => set('fade_ms', Number(e.currentTarget.value))}
      />
      <span class="opacity-val">{fadeMs ? `${(fadeMs / 1000).toFixed(1)}s` : 'cut'}</span>
      {#if fadeMs !== 800}
        <button type="button" class="ghost sm" on:click={() => set('fade_ms', 800)}>Reset</button>
      {/if}
    </div>
  </Field>
</Section>

<Section label="Content">
  <Field label="Name override">
    <input type="text" placeholder="(use entity friendly name)" value={str('name')} on:input={(e) => set('name', e.currentTarget.value)} />
  </Field>
</Section>

<style>
  .opacity-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .opacity-row input[type='range'] {
    flex: 1;
    min-width: 0;
  }
  .opacity-val {
    font-family: var(--c-font-mono, monospace);
    font-size: 0.8125rem;
    color: var(--c-fg-2);
    min-width: 3.5ch;
    text-align: right;
  }
</style>
