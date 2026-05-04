<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';

  let safeArea = { top: 16, right: 16, bottom: 16, left: 16 };
  let loaded = false;
  let saving = false;
  let saved = false;

  onMount(async () => {
    safeArea = await api.settings.getSafeArea();
    loaded = true;
  });

  async function save() {
    saving = true;
    saved = false;
    try {
      safeArea = await api.settings.updateSafeArea(safeArea);
      saved = true;
      setTimeout(() => (saved = false), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'save failed');
    } finally {
      saving = false;
    }
  }
</script>

<h1>Settings</h1>

{#if !loaded}
  <p>Loading…</p>
{:else}
  <section class="panel">
    <h2>Safe-area padding</h2>
    <p class="hint">Pulls widgets and overlays in from the screen edges so wall-mount bezels don't cover them. Background gradients still bleed to the edge.</p>
    <div class="grid">
      <Field label="Top (px)">
        <input type="number" min="0" bind:value={safeArea.top} />
      </Field>
      <Field label="Right (px)">
        <input type="number" min="0" bind:value={safeArea.right} />
      </Field>
      <Field label="Bottom (px)">
        <input type="number" min="0" bind:value={safeArea.bottom} />
      </Field>
      <Field label="Left (px)">
        <input type="number" min="0" bind:value={safeArea.left} />
      </Field>
    </div>
    <div class="actions">
      <button on:click={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      {#if saved}<span class="status">Saved</span>{/if}
    </div>
  </section>
{/if}

<style>
  h1 { margin: 0 0 1.5rem; font-weight: 300; }
  h2 { margin: 0 0 0.5rem; font-weight: 400; font-size: 1.1rem; }
  .panel {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 0.75rem;
    padding: 1.25rem;
  }
  .hint {
    color: #888;
    font-size: 0.9rem;
    margin: 0 0 1rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  input {
    background: #0a0a0a;
    color: #eee;
    border: 1px solid #2a2a2a;
    border-radius: 0.4rem;
    padding: 0.5rem 0.65rem;
    font-size: 0.95rem;
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  button {
    background: #f5f5f5;
    color: #0a0a0a;
    border: none;
    padding: 0.6rem 1.1rem;
    border-radius: 0.5rem;
    font-size: 1rem;
    cursor: pointer;
    font-family: inherit;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .status { color: #8aff8a; font-size: 0.9rem; }
</style>
