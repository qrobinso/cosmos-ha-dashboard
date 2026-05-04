<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/admin/api';

  type Rotation = { enabled: boolean; sceneIds: string[]; intervalSec: number };

  let displays: Awaited<ReturnType<typeof api.displays.list>> = [];
  let scenes: Awaited<ReturnType<typeof api.scenes.list>> = [];
  let loading = true;
  let busy = '';
  let openRotation: string | null = null;
  let rotationDraft: Record<string, Rotation> = {};

  async function refresh() {
    loading = true;
    [displays, scenes] = await Promise.all([api.displays.list(), api.scenes.list()]);
    rotationDraft = {};
    for (const d of displays) {
      rotationDraft[d.id] = d.rotation ?? { enabled: false, sceneIds: [], intervalSec: 60 };
    }
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

  async function setOrientation(displayName: string, orientation: 'landscape' | 'portrait') {
    busy = displayName;
    try {
      await api.displays.setOrientation(displayName, orientation);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'orientation update failed');
    } finally {
      busy = '';
    }
  }

  function toggleRotation(displayId: string, sceneId: string) {
    const draft = rotationDraft[displayId];
    if (!draft) return;
    const idx = draft.sceneIds.indexOf(sceneId);
    if (idx >= 0) {
      draft.sceneIds = draft.sceneIds.filter((s) => s !== sceneId);
    } else {
      draft.sceneIds = [...draft.sceneIds, sceneId];
    }
    rotationDraft = rotationDraft;
  }

  function moveSceneUp(displayId: string, sceneId: string) {
    const draft = rotationDraft[displayId];
    if (!draft) return;
    const idx = draft.sceneIds.indexOf(sceneId);
    if (idx <= 0) return;
    const next = [...draft.sceneIds];
    const prev = next[idx - 1];
    next[idx - 1] = next[idx];
    next[idx] = prev;
    draft.sceneIds = next;
    rotationDraft = rotationDraft;
  }

  async function saveRotation(displayName: string, displayId: string) {
    busy = displayName;
    try {
      const draft = rotationDraft[displayId];
      if (!draft) return;
      if (draft.enabled && draft.sceneIds.length === 0) {
        alert('Pick at least one scene to enable rotation.');
        return;
      }
      await api.displays.setRotation(displayName, draft);
      await refresh();
      openRotation = null;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'save rotation failed');
    } finally {
      busy = '';
    }
  }

  function rotationSummary(r: Rotation | null): string {
    if (!r || !r.enabled || r.sceneIds.length === 0) return 'off';
    return `${r.sceneIds.length} scenes · every ${r.intervalSec}s`;
  }

  onMount(refresh);
</script>

<header class="page-header reveal reveal-1">
  <span class="eyebrow">Displays</span>
  <h1>Connected devices.</h1>
</header>

{#if loading}
  <p class="loading">Loading…</p>
{:else if displays.length === 0}
  <div class="empty-state reveal reveal-2">
    <h2>No displays yet.</h2>
    <p>Open <code>http://&lt;host&gt;:8099/</code> on a device (or this browser) and name it to register.</p>
  </div>
{:else}
  <div class="table-wrap reveal reveal-2">
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Default scene</th>
        <th>Active scene</th>
        <th>Orientation</th>
        <th>Rotation</th>
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
          <td>
            <select
              value={d.orientation}
              on:change={(e) => {
                const v = e.currentTarget.value;
                if (v === 'landscape' || v === 'portrait') setOrientation(d.name, v);
              }}
              disabled={busy === d.name}
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </td>
          <td>
            <button
              class="link"
              type="button"
              on:click={() => (openRotation = openRotation === d.id ? null : d.id)}
            >
              {rotationSummary(d.rotation)} {openRotation === d.id ? '▴' : '▾'}
            </button>
          </td>
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
        {#if openRotation === d.id && rotationDraft[d.id]}
          <tr class="rotation-row">
            <td colspan="7">
              <div class="rotation-panel">
                <label class="enable-row">
                  <input type="checkbox" bind:checked={rotationDraft[d.id].enabled} />
                  <span>Enable rotation</span>
                </label>
                <div class="interval-row">
                  <span>Switch every</span>
                  <input type="number" min="5" bind:value={rotationDraft[d.id].intervalSec} />
                  <span>seconds (min 5)</span>
                </div>
                <div class="scene-pickers">
                  <div class="picker-col">
                    <h4>Available scenes</h4>
                    <ul class="picker-list">
                      {#each scenes.filter((s) => !rotationDraft[d.id].sceneIds.includes(s.id)) as s (s.id)}
                        <li>
                          <button type="button" on:click={() => toggleRotation(d.id, s.id)}>+ {s.name}</button>
                        </li>
                      {/each}
                    </ul>
                  </div>
                  <div class="picker-col">
                    <h4>Rotation order</h4>
                    {#if rotationDraft[d.id].sceneIds.length === 0}
                      <p class="hint">Add scenes from the left.</p>
                    {:else}
                      <ol class="picker-list ordered">
                        {#each rotationDraft[d.id].sceneIds as sid, i (sid)}
                          {@const s = scenes.find((x) => x.id === sid)}
                          <li>
                            <span class="seq">{i + 1}.</span>
                            <span class="name">{s?.name ?? sid}</span>
                            <button class="ghost" type="button" on:click={() => moveSceneUp(d.id, sid)} disabled={i === 0}>↑</button>
                            <button class="ghost danger" type="button" on:click={() => toggleRotation(d.id, sid)}>×</button>
                          </li>
                        {/each}
                      </ol>
                    {/if}
                  </div>
                </div>
                <div class="rotation-actions">
                  <button on:click={() => saveRotation(d.name, d.id)} disabled={busy === d.name}>Save rotation</button>
                  <button class="ghost" on:click={() => (openRotation = null)}>Cancel</button>
                </div>
              </div>
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
  </div>
{/if}

<style>
  .page-header {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 1.5rem;
  }
  .page-header h1 {
    font-size: clamp(1.5rem, 3.5vw, 2rem);
  }
  .loading { color: var(--c-fg-3); }
  .empty-state {
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    padding: 3rem 1.5rem;
    text-align: center;
  }
  .empty-state code {
    background: var(--c-surface-2);
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
    font-family: var(--f-mono);
    font-size: 0.85em;
  }
  .table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
  }
  table { width: 100%; border-collapse: collapse; min-width: 56rem; }
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
  button {
    background: #f5f5f5;
    color: #0a0a0a;
    border: none;
    padding: 0.45rem 0.8rem;
    border-radius: 0.4rem;
    font-size: 0.9rem;
    cursor: pointer;
    font-family: inherit;
  }
  button.ghost {
    background: transparent;
    color: #ccc;
    border: 1px solid #2a2a2a;
  }
  button.ghost.danger { color: #ff8a8a; border-color: #3a2222; }
  button.link {
    background: transparent;
    color: #cfd8ff;
    border: none;
    padding: 0;
    font-size: 0.9rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .rotation-row td { background: #131313; }
  .rotation-panel {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 0.5rem 0.25rem;
  }
  .enable-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
  }
  .interval-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: #ccc;
  }
  .interval-row input {
    background: #0a0a0a;
    color: #eee;
    border: 1px solid #2a2a2a;
    border-radius: 0.4rem;
    padding: 0.35rem 0.55rem;
    width: 5rem;
    font-family: inherit;
  }
  .scene-pickers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  .picker-col h4 {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    color: #aaa;
    font-weight: 500;
  }
  .picker-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .picker-list.ordered li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: #0a0a0a;
    border: 1px solid #2a2a2a;
    border-radius: 0.35rem;
    padding: 0.3rem 0.5rem;
  }
  .picker-list .seq {
    color: #888;
    font-size: 0.8rem;
    min-width: 1.5rem;
  }
  .picker-list .name {
    flex: 1;
  }
  .picker-list button.ghost {
    padding: 0.15rem 0.45rem;
    font-size: 0.8rem;
  }
  .picker-list:not(.ordered) li button {
    background: transparent;
    color: #cfd8ff;
    border: 1px solid #2a3a5a;
    text-align: left;
    width: 100%;
    padding: 0.3rem 0.55rem;
  }
  .hint { color: #888; font-size: 0.85rem; margin: 0; }
  .rotation-actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
