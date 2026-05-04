<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/admin/api';

  let scenes: Awaited<ReturnType<typeof api.scenes.list>> = [];
  let loading = true;
  let error: string | null = null;
  let query = '';
  let creating = false;

  $: filtered = query.trim().length === 0
    ? scenes
    : scenes.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));

  async function refresh() {
    loading = true;
    error = null;
    try {
      scenes = await api.scenes.list();
    } catch (err) {
      error = err instanceof Error ? err.message : 'failed to load scenes';
    } finally {
      loading = false;
    }
  }

  async function createNew() {
    if (creating) return;
    creating = true;
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const created = await api.scenes.create({
        name: `New scene · ${stamp}`,
        layout: { cols: 12, rows: 8, items: [] },
        background: { type: 'solid', color: '#101010' },
        typography: { font_family: 'Inter', font_scale: 1.0 },
        widgets: [],
      });
      goto(`/admin/scenes/${created.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'failed to create scene');
      creating = false;
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete scene "${name}"?`)) return;
    try {
      await api.scenes.delete(id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'failed to delete scene');
    }
  }

  function bgPreviewStyle(s: (typeof scenes)[number]): string {
    if (s.background.type === 'solid') return `background: ${s.background.color};`;
    const colors = s.background.colors.length > 0 ? s.background.colors : ['#1a1a2e', '#16213e'];
    return `background: linear-gradient(135deg, ${colors.join(', ')});`;
  }

  onMount(refresh);
</script>

<header class="page-header reveal reveal-1">
  <div>
    <span class="eyebrow">Scenes</span>
    <h1>Layouts and widgets.</h1>
  </div>
  <button class="primary" on:click={createNew} disabled={creating}>
    {creating ? 'Creating…' : '+ New scene'}
  </button>
</header>

<div class="toolbar reveal reveal-2">
  <div class="search">
    <span class="icon" aria-hidden="true">⌕</span>
    <input
      type="search"
      placeholder="Search scenes…"
      bind:value={query}
      aria-label="Search scenes"
    />
  </div>
  {#if !loading && !error}
    <span class="count tag muted">{filtered.length} of {scenes.length}</span>
  {/if}
</div>

{#if loading}
  <p class="loading">Loading…</p>
{:else if error}
  <p class="error">{error}</p>
{:else if scenes.length === 0}
  <div class="empty-state reveal reveal-2">
    <h2>No scenes yet.</h2>
    <p>A scene is a layout of widgets shown on a tablet — like a Morning routine or a Dinner overlay.</p>
    <button class="primary" on:click={createNew} disabled={creating}>
      {creating ? 'Creating…' : 'Create your first scene'}
    </button>
  </div>
{:else if filtered.length === 0}
  <p class="empty">No scenes match "{query}".</p>
{:else}
  <ul class="scene-grid reveal reveal-3">
    {#each filtered as s (s.id)}
      <li class="scene">
        <a href="/admin/scenes/{s.id}" class="thumb" aria-label={`Edit ${s.name}`}>
          <div class="thumb-bg" style={bgPreviewStyle(s)}></div>
          <span class="thumb-tag">{s.background.type}</span>
        </a>
        <div class="info">
          <a class="name" href="/admin/scenes/{s.id}">{s.name}</a>
          <div class="meta">
            <span class="tag">{s.widgets.length} widget{s.widgets.length === 1 ? '' : 's'}</span>
            {#if s.defaultTransitionId}
              <span class="tag muted mono">{s.defaultTransitionId.replace('builtin-', '')}</span>
            {/if}
          </div>
        </div>
        <div class="row-actions">
          <a href="/admin/scenes/{s.id}" class="btn ghost">Edit</a>
          <button class="ghost danger icon" aria-label="Delete scene" on:click={() => remove(s.id, s.name)}>×</button>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }
  .page-header h1 {
    font-size: clamp(1.5rem, 3.5vw, 2rem);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .search {
    flex: 1;
    position: relative;
  }
  .search input {
    padding-left: 2.5rem;
  }
  .search .icon {
    position: absolute;
    left: 0.85rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--c-fg-3);
    font-size: 1rem;
    pointer-events: none;
  }
  .count {
    flex-shrink: 0;
  }

  .loading, .empty, .error {
    color: var(--c-fg-3);
    padding: 1rem 0;
  }
  .error { color: var(--c-danger); }

  .empty-state {
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    padding: 3rem 1.5rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
  }
  .empty-state p { max-width: 28rem; }

  .scene-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.85rem;
  }
  .scene {
    display: grid;
    grid-template-columns: 5rem 1fr auto;
    gap: 1rem;
    align-items: center;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    padding: 0.85rem;
    transition: background 150ms var(--ease), border-color 150ms var(--ease);
  }
  .scene:hover {
    background: var(--c-surface-hover);
    border-color: var(--c-line-strong);
  }

  .thumb {
    position: relative;
    display: block;
    width: 5rem;
    aspect-ratio: 16 / 10;
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: 1px solid var(--c-line);
  }
  .thumb-bg {
    position: absolute;
    inset: 0;
  }
  .thumb-tag {
    position: absolute;
    bottom: 0.25rem;
    right: 0.25rem;
    font-family: var(--f-mono);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.85);
    background: rgba(0, 0, 0, 0.45);
    padding: 0.1rem 0.35rem;
    border-radius: 0.25rem;
    backdrop-filter: blur(2px);
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    color: var(--c-fg);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name:hover { color: var(--c-accent); }
  .meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .row-actions .btn {
    padding: 0 0.85rem;
    min-height: 2.25rem;
    font-size: 0.85rem;
    text-decoration: none;
  }
  .row-actions .icon {
    width: 2.25rem;
    min-height: 2.25rem;
    font-size: 1.15rem;
    line-height: 1;
  }

  @media (max-width: 480px) {
    .scene { grid-template-columns: 4rem 1fr; grid-template-rows: auto auto; }
    .thumb { width: 4rem; }
    .row-actions {
      grid-column: 1 / -1;
      justify-content: flex-end;
    }
  }
</style>
