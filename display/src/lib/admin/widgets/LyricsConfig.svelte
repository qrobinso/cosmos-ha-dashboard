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
  // Stored 0..1; edited as a percentage, which is what people think in.
  $: opacityPct = Math.round((typeof config.opacity === 'number' ? config.opacity : 1) * 100);
  $: badFont = str('custom_font').trim() !== '' && !/^[A-Za-z0-9 ]{1,60}$/.test(str('custom_font').trim());
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
  <Field label="Text size" hint="Relative to the scene's font scale.">
    <select value={str('text_size', 'normal')} on:change={(e) => set('text_size', e.currentTarget.value)}>
      <option value="normal">Normal</option>
      <option value="large">Large</option>
      <option value="xl">Extra large</option>
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
  <Field
    label="Custom Google font"
    hint={badFont
      ? 'Use the family name exactly as fonts.google.com shows it — letters, numbers and spaces only.'
      : 'Any family from fonts.google.com, e.g. Lobster. Becomes the main font, and joins the mood mix if one is set. The wall display needs internet to load it.'}
  >
    <input
      type="text"
      placeholder="Lobster"
      value={str('custom_font')}
      on:input={(e) => set('custom_font', e.currentTarget.value || undefined)}
    />
  </Field>
  <Field label="Opacity" hint="Fade the lyrics back so they sit in the scene rather than on top of it.">
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
