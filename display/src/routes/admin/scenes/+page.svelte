<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/admin/api';

  let scenes: Awaited<ReturnType<typeof api.scenes.list>> = [];
  let loading = true;
  let error: string | null = null;

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
    try {
      const created = await api.scenes.create({
        name: `New scene ${new Date().toLocaleString()}`,
        layout: { cols: 12, rows: 8, items: [] },
        background: { type: 'solid', color: '#101010' },
        typography: { font_family: 'Inter', font_scale: 1.0 },
        widgets: [],
      });
      goto(`/admin/scenes/${created.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'failed to create scene');
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

  onMount(refresh);
</script>

<header class="page-header">
  <h1>Scenes</h1>
  <button on:click={createNew}>+ New scene</button>
</header>

{#if loading}
  <p>Loading…</p>
{:else if error}
  <p class="error">{error}</p>
{:else if scenes.length === 0}
  <p class="empty">No scenes yet — create your first one.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Background</th>
        <th>Widgets</th>
        <th>Default transition</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each scenes as s (s.id)}
        <tr>
          <td><a href="/admin/scenes/{s.id}">{s.name}</a></td>
          <td>{s.background.type}</td>
          <td>{s.widgets.length}</td>
          <td>{s.defaultTransitionId ?? '—'}</td>
          <td><button class="danger" on:click={() => remove(s.id, s.name)}>Delete</button></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  h1 { margin: 0; font-weight: 300; }
  button {
    background: #f5f5f5;
    color: #0a0a0a;
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.95rem;
    cursor: pointer;
  }
  button.danger {
    background: transparent;
    color: #ff8a8a;
    padding: 0.35rem 0.6rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    text-align: left;
    padding: 0.65rem 0.5rem;
    border-bottom: 1px solid #2a2a2a;
  }
  th { color: #aaa; font-weight: 500; font-size: 0.85rem; }
  td a { color: #fff; }
  .empty, .error {
    color: #aaa;
    padding: 2rem 0;
    text-align: center;
  }
  .error { color: #ff8a8a; }
</style>
