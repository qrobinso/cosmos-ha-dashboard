<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { designs } from './api';

  const STORAGE_KEY = 'cosmos.agent.designPack';

  type Pack = {
    id: string;
    slug: string;
    name: string;
    source: 'builtin' | 'user';
    preview: { colors: string[]; font_family: string | null };
  };

  let packs: Pack[] = [];
  let selectedSlug: string = '';
  let loaded = false;

  const dispatch = createEventDispatcher<{ change: { slug: string | null } }>();

  onMount(async () => {
    try {
      packs = await designs.list();
    } catch {
      packs = [];
    }
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && packs.some((p) => p.slug === stored)) {
        selectedSlug = stored;
      }
    }
    loaded = true;
    dispatch('change', { slug: selectedSlug || null });
  });

  function onChange() {
    if (typeof localStorage !== 'undefined') {
      if (selectedSlug) localStorage.setItem(STORAGE_KEY, selectedSlug);
      else localStorage.removeItem(STORAGE_KEY);
    }
    dispatch('change', { slug: selectedSlug || null });
  }

  $: builtins = packs.filter((p) => p.source === 'builtin');
  $: userPacks = packs.filter((p) => p.source === 'user');
  $: current = packs.find((p) => p.slug === selectedSlug) ?? null;
</script>

{#if loaded}
  <div class="design-pack-picker">
    <label for="design-pack-select">
      <span class="label-text">Design</span>
    </label>
    <select id="design-pack-select" bind:value={selectedSlug} on:change={onChange}>
      <option value="">— None —</option>
      {#if builtins.length > 0}
        <optgroup label="Built-in">
          {#each builtins as p (p.slug)}<option value={p.slug}>{p.name}</option>{/each}
        </optgroup>
      {/if}
      {#if userPacks.length > 0}
        <optgroup label="Yours">
          {#each userPacks as p (p.slug)}<option value={p.slug}>{p.name}</option>{/each}
        </optgroup>
      {/if}
    </select>
    {#if current}
      <div class="preview" aria-label="Design pack preview">
        <div class="swatches">
          {#each current.preview.colors as c}<span class="swatch" style="background: {c}"></span>{/each}
        </div>
        {#if current.preview.font_family}
          <span class="font" style="font-family: {current.preview.font_family}, system-ui, sans-serif">
            {current.preview.font_family}
          </span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .design-pack-picker {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--c-line, rgba(255, 255, 255, 0.08));
    border-radius: var(--radius-sm, 8px);
    background: var(--c-surface, rgba(255, 255, 255, 0.02));
    flex-wrap: wrap;
  }
  .label-text {
    font-size: 0.85rem;
    color: var(--c-fg-3, #9b9b9b);
  }
  select {
    background: transparent;
    color: var(--c-fg, #f0f0f0);
    border: 1px solid var(--c-line, rgba(255, 255, 255, 0.12));
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font: inherit;
    min-height: 2rem;
  }
  .preview {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }
  .swatches { display: inline-flex; gap: 2px; }
  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .font {
    font-size: 0.85rem;
    color: var(--c-fg-3, #9b9b9b);
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--c-surface-2, rgba(255, 255, 255, 0.04));
  }
</style>
