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

<header class="page-header reveal reveal-1">
  <span class="eyebrow">Settings</span>
  <h1>Global preferences.</h1>
</header>

{#if !loaded}
  <p class="loading">Loading…</p>
{:else}
  <section class="card reveal reveal-2">
    <h2>Safe-area padding</h2>
    <p class="hint">Inset widgets and overlays so bezels don't cover them. Background gradients still bleed to the edge.</p>

    <div class="grid">
      <Field label="Top (px)"><input type="number" min="0" bind:value={safeArea.top} /></Field>
      <Field label="Right (px)"><input type="number" min="0" bind:value={safeArea.right} /></Field>
      <Field label="Bottom (px)"><input type="number" min="0" bind:value={safeArea.bottom} /></Field>
      <Field label="Left (px)"><input type="number" min="0" bind:value={safeArea.left} /></Field>
    </div>

    <div class="preview" aria-hidden="true">
      <div
        class="preview-inset"
        style={`top:${Math.min(safeArea.top, 60)}px;right:${Math.min(safeArea.right, 60)}px;bottom:${Math.min(safeArea.bottom, 60)}px;left:${Math.min(safeArea.left, 60)}px;`}
      ></div>
    </div>

    <div class="actions">
      <button class="primary" on:click={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      {#if saved}<span class="status"><span class="check">✓</span> Saved</span>{/if}
    </div>
  </section>
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
  .hint {
    color: var(--c-fg-3);
    font-size: 0.9rem;
    margin: 0 0 1rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .preview {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background:
      linear-gradient(135deg, rgba(243, 162, 106, 0.18), rgba(111, 196, 196, 0.12)),
      var(--c-surface-2);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    overflow: hidden;
    margin-bottom: 1rem;
  }
  .preview-inset {
    position: absolute;
    border: 1.5px dashed rgba(243, 162, 106, 0.55);
    border-radius: 0.4rem;
    background: rgba(255, 255, 255, 0.02);
    transition: top 200ms var(--ease), right 200ms var(--ease), bottom 200ms var(--ease), left 200ms var(--ease);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--c-success);
    font-size: 0.9rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 999px;
    background: rgba(109, 213, 140, 0.18);
    font-size: 0.7rem;
  }

  @media (min-width: 600px) {
    .grid { grid-template-columns: repeat(4, 1fr); }
  }
</style>
