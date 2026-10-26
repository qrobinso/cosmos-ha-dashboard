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

  const STYLES = [
    { value: 'spotlight', label: 'Spotlight — scrolls, current line lit' },
    { value: 'karaoke', label: 'Karaoke — one big line, colour sweeps across' },
    { value: 'poster', label: 'Poster — each line typeset like a poster' },
    { value: 'drift', label: 'Drift — lines float up and dissolve' },
  ];

  const MOODS = [
    { value: '', label: 'Scene font' },
    { value: 'editorial', label: 'Editorial — Playfair, Cormorant italic, hairline Inter' },
    { value: 'gig', label: 'Gig poster — Bebas Neue, Archivo Black, Permanent Marker' },
    { value: 'handwritten', label: 'Handwritten — Caveat, Permanent Marker' },
    { value: 'retro', label: 'Retro glam — Abril Fatface, Syne, Monoton' },
    { value: 'mixtape', label: 'Mixtape — every font, ransom-note style' },
  ];

  $: mediaPlayers = entities.filter((e) => e.entity_id.startsWith('media_player.'));
  $: offsetMs = typeof config.offset_ms === 'number' ? config.offset_ms : 0;
</script>

<Section label="Source">
  <Field label="Media player" hint="Shows the lyrics for whatever this player is playing, when LRCLIB has them. Hidden otherwise.">
    <EntityPicker
      value={str('entity_id')}
      entities={mediaPlayers}
      placeholder="Search media players…"
      on:change={(e) => set('entity_id', e.detail)}
    />
  </Field>
</Section>

<Section label="Style">
  <Field label="Display style">
    <select value={str('style', 'spotlight')} on:change={(e) => set('style', e.currentTarget.value)}>
      {#each STYLES as s}
        <option value={s.value}>{s.label}</option>
      {/each}
    </select>
  </Field>
  <Field
    label="Font mood"
    hint="Spotlight and Karaoke use the mood's main font; Poster and Drift mix all of its fonts and sizes."
  >
    <select value={str('font_mood')} on:change={(e) => set('font_mood', e.currentTarget.value || undefined)}>
      {#each MOODS as m}
        <option value={m.value}>{m.label}</option>
      {/each}
    </select>
  </Field>
  <Field label="Accent colour" hint="Used for the karaoke sweep and the chorus. Any CSS colour; leave empty for warm gold.">
    <input
      type="text"
      placeholder="#ffc65c"
      value={str('accent')}
      on:input={(e) => set('accent', e.currentTarget.value)}
    />
  </Field>
  <Field
    label="Sync offset (ms)"
    hint="Nudge timing if your speaker reports its position late or early. Positive shows lyrics sooner."
  >
    <input
      type="number"
      step="100"
      value={offsetMs}
      on:input={(e) => set('offset_ms', Number(e.currentTarget.value) || 0)}
    />
  </Field>
</Section>
