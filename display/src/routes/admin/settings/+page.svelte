<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';

  let safeArea = { top: 16, right: 16, bottom: 16, left: 16 };
  let transitionSpeed = 1.0;
  let transitionSpeedRange = { min: 0.25, max: 3.0, default: 1.0 };
  let loaded = false;
  let saving = false;
  let saved = false;
  let savingSpeed = false;
  let savedSpeed = false;

  /** Three named presets map to multipliers; the slider stores the raw number. */
  const SPEED_PRESETS: { label: string; value: number }[] = [
    { label: 'Slow', value: 1.5 },
    { label: 'Normal', value: 1.0 },
    { label: 'Fast', value: 0.6 },
  ];

  onMount(async () => {
    const [sa, ts] = await Promise.all([
      api.settings.getSafeArea(),
      api.settings.getTransitionSpeed(),
    ]);
    safeArea = sa;
    transitionSpeed = ts.multiplier;
    transitionSpeedRange = { min: ts.min, max: ts.max, default: ts.default };
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

  async function saveSpeed() {
    savingSpeed = true;
    savedSpeed = false;
    try {
      const res = await api.settings.updateTransitionSpeed(transitionSpeed);
      transitionSpeed = res.multiplier;
      savedSpeed = true;
      setTimeout(() => (savedSpeed = false), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'save failed');
    } finally {
      savingSpeed = false;
    }
  }

  function pickPreset(value: number) {
    transitionSpeed = value;
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

  <section class="card reveal reveal-3">
    <h2>Transition speed</h2>
    <p class="hint">
      Global multiplier applied to every scene transition's <code>out</code> and <code>in</code> phases.
      1.0× is the baked-in default; lower values are faster, higher values are slower.
    </p>

    <div class="speed-presets">
      {#each SPEED_PRESETS as preset (preset.value)}
        <button
          type="button"
          class="preset"
          class:active={Math.abs(transitionSpeed - preset.value) < 0.01}
          on:click={() => pickPreset(preset.value)}
        >
          <span class="preset-label">{preset.label}</span>
          <span class="preset-value">{preset.value.toFixed(2)}×</span>
        </button>
      {/each}
    </div>

    <Field label={`Custom multiplier — ${transitionSpeed.toFixed(2)}×`}>
      <input
        type="range"
        min={transitionSpeedRange.min}
        max={transitionSpeedRange.max}
        step="0.05"
        bind:value={transitionSpeed}
      />
    </Field>

    <div class="actions">
      <button class="primary" on:click={saveSpeed} disabled={savingSpeed}>
        {savingSpeed ? 'Saving…' : 'Save changes'}
      </button>
      {#if savedSpeed}<span class="status"><span class="check">✓</span> Saved</span>{/if}
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

  .speed-presets {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    margin: 0.5rem 0 1.25rem;
  }
  .preset {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: 0.85rem 0.5rem;
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    background: var(--c-surface);
    color: var(--c-fg-2);
    cursor: pointer;
    transition: border-color 150ms var(--ease), color 150ms var(--ease), background 150ms var(--ease);
  }
  .preset:hover { border-color: var(--c-line-strong); color: var(--c-fg); }
  .preset.active {
    border-color: var(--c-accent);
    color: var(--c-fg);
    background: var(--c-accent-tint);
  }
  .preset-label { font-size: 0.95rem; font-weight: 500; }
  .preset-value {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    opacity: 0.75;
  }
</style>
