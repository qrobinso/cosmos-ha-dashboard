<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/admin/api';

  let displays: Awaited<ReturnType<typeof api.displays.list>> = [];
  let scenes: Awaited<ReturnType<typeof api.scenes.list>> = [];
  let loading = true;
  let busy = '';

  async function refresh() {
    loading = true;
    [displays, scenes] = await Promise.all([api.displays.list(), api.scenes.list()]);
    loading = false;
  }

  function sceneName(id: string | null): string {
    if (!id) return '—';
    return scenes.find((s) => s.id === id)?.name ?? `(${id.slice(0, 8)}…)`;
  }

  async function assign(displayName: string, sceneId: string, makeDefault: boolean) {
    busy = displayName;
    try {
      await api.displays.assignScene(displayName, sceneId, makeDefault);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'assign failed');
    } finally {
      busy = '';
    }
  }

  async function activate(displayName: string, sceneId: string) {
    busy = displayName;
    try {
      await api.displays.activateScene(displayName, sceneId);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'activate failed');
    } finally {
      busy = '';
    }
  }

  onMount(refresh);
</script>

<h1>Displays</h1>

{#if loading}
  <p>Loading…</p>
{:else if displays.length === 0}
  <p class="empty">No displays yet — open <code>http://localhost:8099/</code> on a tablet (or this browser) to register one.</p>
{:else}
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Default scene</th>
        <th>Active scene</th>
        <th>Last seen</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      {#each displays as d (d.id)}
        <tr>
          <td>{d.name}</td>
          <td>{sceneName(d.defaultSceneId)}</td>
          <td>{sceneName(d.currentSceneId)}</td>
          <td>{d.lastSeen ?? '—'}</td>
          <td>
            <select on:change={(e) => assign(d.name, e.currentTarget.value, true)} disabled={busy === d.name}>
              <option value="">Set default…</option>
              {#each scenes as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
            </select>
            <select on:change={(e) => activate(d.name, e.currentTarget.value)} disabled={busy === d.name}>
              <option value="">Activate now…</option>
              {#each scenes as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
            </select>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  h1 { margin: 0 0 1.5rem; font-weight: 300; }
  table { width: 100%; border-collapse: collapse; }
  th, td {
    text-align: left;
    padding: 0.65rem 0.5rem;
    border-bottom: 1px solid #2a2a2a;
    vertical-align: middle;
  }
  th { color: #aaa; font-weight: 500; font-size: 0.85rem; }
  td select {
    background: #0a0a0a;
    color: #eee;
    border: 1px solid #2a2a2a;
    border-radius: 0.4rem;
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
    margin-right: 0.5rem;
  }
  .empty {
    color: #aaa;
    padding: 2rem 0;
    text-align: center;
  }
  code {
    background: #1a1a1a;
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
  }
</style>
