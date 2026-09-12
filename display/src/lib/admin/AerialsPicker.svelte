<script lang="ts">
  /**
   * Picker for the mood engine's Apple TV aerials source: one collapsible
   * group per Apple category, each with a whole-type checkbox, plus per-clip
   * thumbnails. Whole-type picks are stored as `categories` (so clips Apple
   * adds later join automatically); individual picks as `ids`.
   */
  import { onMount } from 'svelte';
  import { api, type AerialCatalogEntry } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';
  import type { AerialCategory, AerialMoodConfig } from '$lib/types';
  import { AERIAL_INTERVALS_MIN } from '$lib/types';

  export let selection: AerialMoodConfig;

  const CATEGORIES: { slug: AerialCategory; label: string }[] = [
    { slug: 'earth', label: 'Earth' },
    { slug: 'landscape', label: 'Landscape' },
    { slug: 'city', label: 'Cityscape' },
    { slug: 'sea', label: 'Underwater' },
  ];
  const INTERVAL_LABELS: Record<number, string> = {
    0: 'When the clip ends',
    5: 'Every 5 minutes',
    15: 'Every 15 minutes',
    30: 'Every 30 minutes',
    60: 'Every hour',
    120: 'Every 2 hours',
    240: 'Every 4 hours',
  };
  /** Rough per-clip size for the storage estimate (1080p H.264, 3–5 min). */
  const EST_MB_PER_CLIP = 200;

  let assets: AerialCatalogEntry[] = [];
  let fetchedAt: number | null = null;
  let loading = true;
  let refreshing = false;
  let refreshError: string | null = null;
  let open: Record<AerialCategory, boolean> = { earth: true, landscape: true, city: true, sea: true };

  onMount(load);

  async function load() {
    loading = true;
    const res = await api.aerials.list();
    assets = res.assets;
    fetchedAt = res.fetchedAt;
    loading = false;
  }

  async function refresh() {
    refreshing = true;
    refreshError = null;
    const res = await api.aerials.refresh();
    if (!res.ok) refreshError = res.error;
    else await load();
    refreshing = false;
  }

  $: categories = new Set(selection.categories ?? []);
  $: ids = new Set(selection.ids);
  $: groups = CATEGORIES.map((c) => {
    const clips = assets.filter((a) => a.category === c.slug);
    const whole = categories.has(c.slug);
    const picked = whole ? clips.length : clips.filter((a) => ids.has(a.id)).length;
    return { ...c, clips, whole, picked, some: !whole && picked > 0 && picked < clips.length };
  });
  $: selectedCount = groups.reduce((n, g) => n + g.picked, 0);
  $: estimateGb = (selectedCount * EST_MB_PER_CLIP) / 1024;

  function setWhole(slug: AerialCategory, on: boolean) {
    const cats = (selection.categories ?? []).filter((c) => c !== slug);
    if (on) cats.push(slug);
    // A whole-type pick implies its clips, so drop them from ids; clearing
    // the type leaves nothing picked for it, which is what unchecking means.
    const inType = new Set(assets.filter((a) => a.category === slug).map((a) => a.id));
    selection = { ...selection, categories: cats, ids: selection.ids.filter((id) => !inType.has(id)) };
  }

  function toggleClip(a: AerialCatalogEntry) {
    if (categories.has(a.category)) return;
    const next = ids.has(a.id) ? selection.ids.filter((id) => id !== a.id) : [...selection.ids, a.id];
    selection = { ...selection, ids: next };
  }

  function setInterval_(e: Event) {
    selection = { ...selection, interval_min: Number((e.currentTarget as HTMLSelectElement).value) };
  }
</script>

<div class="aerials-picker">
  {#if loading}
    <p class="muted">Loading Apple's catalog…</p>
  {:else if assets.length === 0}
    <div class="empty">
      <p>No aerials yet. Cosmos fetches Apple's catalog in the background; fetch it now to pick clips.</p>
      <button type="button" on:click={refresh} disabled={refreshing}>{refreshing ? 'Fetching…' : 'Fetch catalog'}</button>
      {#if refreshError}<p class="error">{refreshError}</p>{/if}
    </div>
  {:else}
    {#each groups as g (g.slug)}
      <section class="group" class:collapsed={!open[g.slug]}>
        <header class="group-head">
          <label class="whole">
            <input
              type="checkbox"
              checked={g.whole}
              indeterminate={g.some}
              on:change={(e) => setWhole(g.slug, e.currentTarget.checked)}
            />
            <span class="group-name">{g.label}</span>
            <span class="tag muted">{g.picked} of {g.clips.length}</span>
            {#if g.whole}<span class="tag accent">whole type</span>{/if}
          </label>
          <button type="button" class="ghost toggle" on:click={() => (open[g.slug] = !open[g.slug])} aria-label="Toggle {g.label}">
            {open[g.slug] ? '▾' : '▸'}
          </button>
        </header>
        {#if open[g.slug]}
          <div class="grid">
            {#each g.clips as a (a.id)}
              <button
                type="button"
                class="clip"
                class:selected={g.whole || ids.has(a.id)}
                class:implied={g.whole}
                disabled={g.whole}
                title={g.whole ? 'Included by the whole-type pick' : a.name}
                on:click={() => toggleClip(a)}
              >
                <img src={a.previewUrl} alt="" loading="lazy" />
                <span class="clip-meta">
                  <span class="clip-name">{a.name}</span>
                  {#if a.subcategory && a.subcategory !== a.name}<span class="clip-sub">{a.subcategory}</span>{/if}
                </span>
                {#if a.cached}<span class="tag success cached">cached</span>{/if}
                <span class="check" aria-hidden="true">✓</span>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/each}

    <div class="options">
      <Field label="Order">
        <label class="inline-check">
          <input type="checkbox" checked={selection.shuffle === true} on:change={(e) => (selection = { ...selection, shuffle: e.currentTarget.checked })} />
          <span>Shuffle</span>
        </label>
      </Field>
      <Field label="Change clip">
        <select value={String(selection.interval_min ?? 30)} on:change={setInterval_}>
          {#each AERIAL_INTERVALS_MIN as m (m)}<option value={String(m)}>{INTERVAL_LABELS[m]}</option>{/each}
        </select>
      </Field>
    </div>

    <p class="summary">
      <strong>{selectedCount}</strong> clip{selectedCount === 1 ? '' : 's'} selected, about
      <strong>{estimateGb < 1 ? `${Math.round(estimateGb * 1024)} MB` : `${estimateGb.toFixed(1)} GB`}</strong> to cache.
      {#if selectedCount === 0}<span class="error">Pick at least one clip or type.</span>{/if}
    </p>
    <p class="muted catalog-line">
      Catalog from Apple{fetchedAt ? `, fetched ${new Date(fetchedAt).toLocaleDateString()}` : ''}.
      <button type="button" class="link" on:click={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      {#if refreshError}<span class="error">{refreshError}</span>{/if}
    </p>
  {/if}
</div>

<style>
  .aerials-picker { display: flex; flex-direction: column; gap: 0.75rem; }
  .muted { color: var(--c-fg-3, #888); font-size: 0.85rem; margin: 0; }
  .error { color: var(--c-danger, #f06b75); font-size: 0.85rem; }
  .empty { display: flex; flex-direction: column; gap: 0.6rem; align-items: flex-start; }
  .empty p { margin: 0; color: var(--c-fg-2, #ccc); }

  .group {
    border: 1px solid var(--c-line, #2a2a2a);
    border-radius: var(--radius-md, 0.75rem);
    background: var(--c-surface, #111);
    overflow: hidden;
  }
  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem 0.35rem 0.75rem;
    min-height: var(--tap, 44px);
  }
  .whole { display: inline-flex; align-items: center; gap: 0.6rem; cursor: pointer; flex: 1; min-height: var(--tap, 44px); }
  .whole input { width: 1.1rem; height: 1.1rem; accent-color: var(--c-accent, #ffd17a); }
  .group-name { font-weight: 500; color: var(--c-fg, #eee); }
  .toggle { min-width: var(--tap, 44px); min-height: var(--tap, 44px); background: none; border: none; color: var(--c-fg-2, #ccc); cursor: pointer; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.5rem;
    padding: 0 0.6rem 0.6rem;
  }
  @media (max-width: 600px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  .clip {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 0;
    border: 2px solid transparent;
    border-radius: var(--radius-sm, 0.5rem);
    background: var(--c-surface-2, #181d2a);
    color: inherit;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
    transition: border-color 160ms var(--ease, ease), transform 160ms var(--ease, ease);
  }
  .clip:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--c-line-strong, #444); }
  .clip.selected { border-color: var(--c-accent, #ffd17a); }
  .clip.implied { opacity: 0.85; cursor: default; }
  .clip img { width: 100%; aspect-ratio: 900 / 580; object-fit: cover; display: block; background: #000; }
  .clip-meta { display: flex; flex-direction: column; gap: 0.1rem; padding: 0.4rem 0.5rem 0.5rem; }
  .clip-name { font-size: 0.85rem; color: var(--c-fg, #eee); }
  .clip-sub { font-size: 0.72rem; color: var(--c-fg-3, #888); }
  .cached { position: absolute; top: 0.35rem; left: 0.35rem; }
  .check {
    position: absolute; top: 0.35rem; right: 0.35rem;
    width: 1.4rem; height: 1.4rem; border-radius: 50%;
    display: none; align-items: center; justify-content: center;
    background: var(--c-accent, #ffd17a); color: #000; font-size: 0.85rem; font-weight: 600;
  }
  .clip.selected .check { display: inline-flex; }

  .options { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  @media (max-width: 600px) { .options { grid-template-columns: 1fr; } }
  .inline-check { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--c-fg-2, #ccc); min-height: var(--tap, 44px); }
  .summary { margin: 0; color: var(--c-fg-2, #ccc); font-size: 0.9rem; }
  .catalog-line .link { background: none; border: none; color: var(--c-accent, #ffd17a); cursor: pointer; padding: 0 0.25rem; font: inherit; font-size: 0.85rem; }
  select { min-height: var(--tap, 44px); }
</style>
