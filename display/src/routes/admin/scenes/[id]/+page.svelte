<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';
  import type { Background, Typography, WidgetKind, WidgetState, Layout } from '$lib/types';

  type Widget = WidgetState;

  $: id = $page.params.id;
  let loaded = false;
  let saving = false;
  let saveStatus: 'saved' | 'error' | null = null;

  let name = '';
  let layout: Layout = { cols: 12, rows: 8, items: [] };
  let background: Background = { type: 'solid', color: '#101010' };
  let typography: Typography = { font_family: 'Inter', font_scale: 1.0 };
  let defaultTransitionId: string | null = null;
  let widgets: Widget[] = [];

  let transitions: { id: string; name: string }[] = [];
  let entities: { entity_id: string; state: string }[] = [];

  const FONT_FAMILIES = ['Inter', 'Fraunces', 'JetBrains Mono', 'Space Grotesk'];
  const FONT_SCALES = [0.8, 1.0, 1.25, 1.5, 2.0];
  const GRADIENT_SPEEDS = ['slow', 'medium', 'fast'] as const;
  const GRADIENT_STYLES = ['mesh', 'linear', 'radial'] as const;
  const WIDGET_KINDS: WidgetKind[] = ['clock', 'weather', 'entity_tile'];

  onMount(async () => {
    const [scene, txns, ents] = await Promise.all([
      api.scenes.get(id),
      api.transitions.list(),
      api.ha.listEntities(),
    ]);
    if (!scene) {
      alert('Scene not found');
      goto('/admin/scenes');
      return;
    }
    name = scene.name;
    layout = scene.layout;
    background = scene.background;
    typography = scene.typography;
    defaultTransitionId = scene.defaultTransitionId;
    widgets = scene.widgets;
    transitions = txns;
    entities = ents;
    loaded = true;
  });

  function setBackgroundType(t: 'solid' | 'gradient') {
    if (t === 'solid') {
      background = { type: 'solid', color: '#101010' };
    } else {
      background = { type: 'gradient', colors: ['#1a1a2e', '#16213e', '#0f3460'], speed: 'slow', style: 'mesh' };
    }
  }

  function addColor() {
    if (background.type !== 'gradient') return;
    background = { ...background, colors: [...background.colors, '#ffffff'] };
  }

  function removeColor(idx: number) {
    if (background.type !== 'gradient') return;
    background = { ...background, colors: background.colors.filter((_, i) => i !== idx) };
  }

  function addWidget() {
    widgets = [
      ...widgets,
      {
        id: crypto.randomUUID(),
        kind: 'clock',
        position: { col: 1, row: 1, w: 4, h: 2 },
        config: {},
        data: null,
      },
    ];
  }

  function removeWidget(idx: number) {
    widgets = widgets.filter((_, i) => i !== idx);
  }

  function setWidgetKind(idx: number, kind: string) {
    const w = { ...widgets[idx], kind: kind as WidgetKind };
    if (kind === 'clock') w.config = { format: '24h' };
    if (kind === 'weather') w.config = {};
    if (kind === 'entity_tile') w.config = { entity_id: entities[0]?.entity_id ?? '' };
    widgets[idx] = w;
    widgets = widgets;
  }

  function configStr(cfg: Record<string, unknown>, key: string, fallback = ''): string {
    const v = cfg[key];
    return typeof v === 'string' ? v : fallback;
  }

  async function save() {
    saving = true;
    saveStatus = null;
    try {
      // Strip the `data` field (server doesn't accept it on input)
      const widgetsForSave = widgets.map(({ data: _data, ...rest }) => rest);
      await api.scenes.update(id, {
        name,
        layout,
        background,
        typography,
        defaultTransitionId,
        widgets: widgetsForSave,
      });
      saveStatus = 'saved';
    } catch (err) {
      saveStatus = 'error';
      alert(err instanceof Error ? err.message : 'save failed');
    } finally {
      saving = false;
      setTimeout(() => (saveStatus = null), 2000);
    }
  }
</script>

{#if !loaded}
  <p>Loading…</p>
{:else}
  <header class="page-header">
    <h1>Scene editor</h1>
    <div class="actions">
      {#if saveStatus === 'saved'}<span class="status saved">Saved</span>{/if}
      <button class="primary" on:click={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  </header>

  <section class="panel">
    <h2>Metadata</h2>
    <Field label="Name">
      <input bind:value={name} />
    </Field>
    <Field label="Default transition">
      <select bind:value={defaultTransitionId}>
        <option value={null}>None</option>
        {#each transitions as t (t.id)}
          <option value={t.id}>{t.name}</option>
        {/each}
      </select>
    </Field>
    <Field label="Grid" hint="cols × rows for the widget layout">
      <div class="grid-input">
        <input type="number" min="1" max="48" bind:value={layout.cols} /> ×
        <input type="number" min="1" max="48" bind:value={layout.rows} />
      </div>
    </Field>
  </section>

  <section class="panel">
    <h2>Background</h2>
    <Field label="Type">
      <div class="radio-row">
        <label><input type="radio" name="bg" checked={background.type === 'solid'} on:change={() => setBackgroundType('solid')} /> Solid</label>
        <label><input type="radio" name="bg" checked={background.type === 'gradient'} on:change={() => setBackgroundType('gradient')} /> Animated gradient</label>
      </div>
    </Field>
    {#if background.type === 'solid'}
      <Field label="Color">
        <input type="color" bind:value={background.color} />
      </Field>
    {:else}
      <Field label="Colors" hint="2–6 colors blend continuously">
        {#each background.colors as _, i}
          <div class="color-row">
            <input type="color" bind:value={background.colors[i]} />
            <button class="danger" type="button" on:click={() => removeColor(i)}>Remove</button>
          </div>
        {/each}
        <button type="button" on:click={addColor}>+ Color</button>
      </Field>
      <Field label="Speed">
        <select bind:value={background.speed}>
          {#each GRADIENT_SPEEDS as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </Field>
      <Field label="Style">
        <select bind:value={background.style}>
          {#each GRADIENT_STYLES as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </Field>
    {/if}
  </section>

  <section class="panel">
    <h2>Typography</h2>
    <Field label="Font family">
      <select bind:value={typography.font_family}>
        {#each FONT_FAMILIES as f (f)}<option value={f}>{f}</option>{/each}
      </select>
    </Field>
    <Field label="Font scale">
      <select bind:value={typography.font_scale}>
        {#each FONT_SCALES as s (s)}<option value={s}>{s}</option>{/each}
      </select>
    </Field>
  </section>

  <section class="panel">
    <header class="panel-header">
      <h2>Widgets</h2>
      <button on:click={addWidget}>+ Add widget</button>
    </header>
    {#if widgets.length === 0}
      <p class="empty">No widgets yet.</p>
    {:else}
      {#each widgets as w, i (w.id)}
        <div class="widget-card">
          <div class="widget-row">
            <Field label="Kind">
              <select value={w.kind} on:change={(e) => setWidgetKind(i, e.currentTarget.value)}>
                {#each WIDGET_KINDS as k (k)}<option value={k}>{k}</option>{/each}
              </select>
            </Field>
            <Field label="Col">
              <input type="number" min="1" bind:value={w.position.col} />
            </Field>
            <Field label="Row">
              <input type="number" min="1" bind:value={w.position.row} />
            </Field>
            <Field label="Width">
              <input type="number" min="1" bind:value={w.position.w} />
            </Field>
            <Field label="Height">
              <input type="number" min="1" bind:value={w.position.h} />
            </Field>
            <button class="danger" type="button" on:click={() => removeWidget(i)}>Remove</button>
          </div>
          {#if w.kind === 'clock'}
            <Field label="Format">
              <select value={configStr(w.config, 'format', '24h')} on:change={(e) => { w.config = { ...w.config, format: e.currentTarget.value }; widgets = widgets; }}>
                <option value="24h">24h</option>
                <option value="12h">12h</option>
              </select>
            </Field>
          {:else if w.kind === 'entity_tile'}
            <Field label="Entity">
              <select value={configStr(w.config, 'entity_id')} on:change={(e) => { w.config = { ...w.config, entity_id: e.currentTarget.value }; widgets = widgets; }}>
                {#each entities as e (e.entity_id)}<option value={e.entity_id}>{e.entity_id}</option>{/each}
              </select>
            </Field>
          {/if}
        </div>
      {/each}
    {/if}
  </section>
{/if}

<style>
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  h1 { margin: 0; font-weight: 300; }
  h2 { margin: 0 0 1rem; font-weight: 400; font-size: 1.1rem; }
  .panel {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 0.75rem;
    padding: 1.25rem;
    margin-bottom: 1.25rem;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  input, select {
    background: #0a0a0a;
    color: #eee;
    border: 1px solid #2a2a2a;
    border-radius: 0.4rem;
    padding: 0.5rem 0.65rem;
    font-size: 0.95rem;
    font-family: inherit;
  }
  input[type='color'] {
    padding: 0;
    width: 3rem;
    height: 2rem;
  }
  input[type='number'] {
    width: 5rem;
  }
  button {
    background: #f5f5f5;
    color: #0a0a0a;
    border: none;
    padding: 0.5rem 0.8rem;
    border-radius: 0.4rem;
    font-size: 0.9rem;
    cursor: pointer;
    font-family: inherit;
  }
  button.primary {
    padding: 0.6rem 1.1rem;
    font-size: 1rem;
  }
  button.danger {
    background: transparent;
    color: #ff8a8a;
    border: 1px solid #3a2222;
  }
  .actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  .status.saved {
    color: #8aff8a;
    font-size: 0.9rem;
  }
  .radio-row {
    display: flex;
    gap: 1.25rem;
  }
  .grid-input {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .color-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }
  .widget-card {
    background: #0f0f0f;
    border: 1px solid #2a2a2a;
    border-radius: 0.5rem;
    padding: 0.85rem;
    margin-bottom: 0.75rem;
  }
  .widget-row {
    display: flex;
    align-items: end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .empty {
    color: #888;
    font-size: 0.9rem;
  }
</style>
