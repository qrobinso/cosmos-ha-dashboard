<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/admin/api';

  type Rotation = { enabled: boolean; sceneIds: string[]; intervalSec: number };

  let displays: Awaited<ReturnType<typeof api.displays.list>> = [];
  let scenes: Awaited<ReturnType<typeof api.scenes.list>> = [];
  let loading = true;
  let busy = '';
  /** displayId → "rotation" | "manage" | null */
  let openPanel: Record<string, 'manage' | null> = {};
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

  function togglePanel(displayId: string) {
    openPanel = { ...openPanel, [displayId]: openPanel[displayId] === 'manage' ? null : 'manage' };
  }

  async function assign(displayName: string, sceneId: string, makeDefault: boolean) {
    if (!sceneId) return;
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
    if (!sceneId) return;
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

  function previewDisplay(displayName: string, orientation: 'landscape' | 'portrait') {
    const url = `/?display=${encodeURIComponent(displayName)}`;
    const portrait = orientation === 'portrait';
    const w = portrait ? 540 : 960;
    const h = portrait ? 960 : 540;
    window.open(url, `cosmos-preview-${displayName}`, `width=${w},height=${h},noopener`);
  }

  async function removeDisplay(displayName: string) {
    const confirmed = confirm(
      `Remove display "${displayName}"?\n\n` +
      `This deletes its assignments, rotation, and Home Assistant entities. ` +
      `If the device is still online, it will re-register on its next reconnect.`
    );
    if (!confirmed) return;
    busy = displayName;
    try {
      await api.displays.delete(displayName);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'remove failed');
    } finally {
      busy = '';
    }
  }

  onMount(refresh);
</script>

<header class="page-header reveal reveal-1">
  <h1>Displays</h1>
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
        <th class="actions-col">Manage</th>
      </tr>
    </thead>
    <tbody>
      {#each displays as d (d.id)}
        <tr class:open={openPanel[d.id] === 'manage'}>
          <td class="name-cell">{d.name}</td>
          <td class="muted">{sceneName(d.defaultSceneId)}</td>
          <td>{sceneName(d.currentSceneId)}</td>
          <td>{d.orientation}</td>
          <td class="muted">{rotationSummary(d.rotation)}</td>
          <td class="muted">{d.lastSeen ?? '—'}</td>
          <td class="actions-col">
            <button
              class="manage-toggle"
              type="button"
              aria-expanded={openPanel[d.id] === 'manage'}
              on:click={() => togglePanel(d.id)}
            >
              {openPanel[d.id] === 'manage' ? 'Close' : 'Manage'}
              <span class="caret">{openPanel[d.id] === 'manage' ? '▴' : '▾'}</span>
            </button>
          </td>
        </tr>
        {#if openPanel[d.id] === 'manage'}
          <tr class="manage-row">
            <td colspan="7">
              <div class="manage-panel">
                <!-- Quick actions -->
                <section class="panel-section">
                  <h4>Quick actions</h4>
                  <div class="quick-row">
                    <button
                      class="ghost"
                      type="button"
                      on:click={() => previewDisplay(d.name, d.orientation)}
                    >Preview</button>

                    <label class="quick-field">
                      <span>Activate scene</span>
                      <select
                        on:change={(e) => { activate(d.name, e.currentTarget.value); e.currentTarget.value = ''; }}
                        disabled={busy === d.name}
                      >
                        <option value="">— Pick to activate —</option>
                        {#each scenes as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
                      </select>
                    </label>
                  </div>
                </section>

                <!-- Defaults -->
                <section class="panel-section">
                  <h4>Defaults</h4>
                  <div class="quick-row">
                    <label class="quick-field">
                      <span>Default scene</span>
                      <select
                        value={d.defaultSceneId ?? ''}
                        on:change={(e) => assign(d.name, e.currentTarget.value, true)}
                        disabled={busy === d.name}
                      >
                        <option value="">— None —</option>
                        {#each scenes as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
                      </select>
                    </label>

                    <label class="quick-field">
                      <span>Orientation</span>
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
                    </label>
                  </div>
                </section>

                <!-- Rotation -->
                <section class="panel-section">
                  <h4>Scene rotation</h4>
                  <label class="enable-row">
                    <input type="checkbox" bind:checked={rotationDraft[d.id].enabled} />
                    <span>Auto-rotate through multiple scenes</span>
                  </label>
                  {#if rotationDraft[d.id].enabled}
                    <div class="interval-row">
                      <span>Switch every</span>
                      <input type="number" min="5" bind:value={rotationDraft[d.id].intervalSec} />
                      <span>seconds (min 5)</span>
                    </div>
                    <div class="scene-pickers">
                      <div class="picker-col">
                        <h5>Available</h5>
                        <ul class="picker-list">
                          {#each scenes.filter((s) => !rotationDraft[d.id].sceneIds.includes(s.id)) as s (s.id)}
                            <li>
                              <button type="button" on:click={() => toggleRotation(d.id, s.id)}>+ {s.name}</button>
                            </li>
                          {/each}
                          {#if scenes.filter((s) => !rotationDraft[d.id].sceneIds.includes(s.id)).length === 0}
                            <li class="hint">All scenes added.</li>
                          {/if}
                        </ul>
                      </div>
                      <div class="picker-col">
                        <h5>Rotation order</h5>
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
                  {/if}
                  <div class="rotation-actions">
                    <button on:click={() => saveRotation(d.name, d.id)} disabled={busy === d.name}>Save rotation</button>
                  </div>
                </section>

                <!-- Danger zone -->
                <section class="panel-section danger-zone">
                  <h4>Danger zone</h4>
                  <p class="hint">
                    Removes this display and its assignments. The device will appear again if it
                    re-registers from the kiosk URL.
                  </p>
                  <button
                    class="danger"
                    type="button"
                    on:click={() => removeDisplay(d.name)}
                    disabled={busy === d.name}
                  >
                    Remove display
                  </button>
                </section>
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
  .page-header h1 { font-size: clamp(1.5rem, 3.5vw, 2rem); }
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
    padding: 0.7rem 0.65rem;
    border-bottom: 1px solid #2a2a2a;
    vertical-align: middle;
  }
  th { color: #aaa; font-weight: 500; font-size: 0.85rem; }
  .name-cell { font-weight: 500; }
  td.muted { color: #999; font-size: 0.92rem; }
  tr.open { background: #131313; }
  tr.open + tr.manage-row { background: #131313; }
  .actions-col { text-align: right; }
  .manage-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: transparent;
    color: #ccc;
    border: 1px solid #2a2a2a;
    padding: 0.4rem 0.8rem;
    border-radius: 0.4rem;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.9rem;
  }
  .manage-toggle[aria-expanded='true'] { background: #1a1a1a; color: #f5f5f5; border-color: #3a3a3a; }
  .caret { font-size: 0.7em; opacity: 0.7; }

  .manage-row td { padding: 0; border-bottom: 1px solid #2a2a2a; }
  .manage-panel {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1rem 1.25rem 1.25rem;
  }
  .panel-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .panel-section h4 {
    margin: 0;
    color: #aaa;
    font-size: 0.78rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .panel-section h5 {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    color: #aaa;
    font-weight: 500;
  }
  .quick-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.85rem;
    align-items: end;
  }
  .quick-field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    flex: 1;
    min-width: 14rem;
  }
  .quick-field > span {
    color: #aaa;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  select, input[type='number'] {
    background: #0a0a0a;
    color: #eee;
    border: 1px solid #2a2a2a;
    border-radius: 0.4rem;
    padding: 0.45rem 0.65rem;
    font-size: 0.92rem;
    font-family: inherit;
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
  .interval-row input { width: 5rem; padding: 0.35rem 0.55rem; }
  .scene-pickers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  @media (max-width: 720px) {
    .scene-pickers { grid-template-columns: 1fr; }
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
  .picker-list .seq { color: #888; font-size: 0.8rem; min-width: 1.5rem; }
  .picker-list .name { flex: 1; }
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
    border-radius: 0.3rem;
    cursor: pointer;
    font-family: inherit;
  }
  .rotation-actions { display: flex; gap: 0.5rem; }
  .hint { color: #888; font-size: 0.85rem; margin: 0; }

  .danger-zone { border-top: 1px dashed #3a2222; padding-top: 1rem; }
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
  button.danger {
    background: transparent;
    color: #ff8a8a;
    border: 1px solid #3a2222;
  }
  button.danger:hover { background: #2a1a1a; }
  code {
    background: #1a1a1a;
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
  }
</style>
