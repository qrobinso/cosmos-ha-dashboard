<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';
  import WidgetCanvas from '$lib/admin/WidgetCanvas.svelte';
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
  let selectedWidgetIdx: number | null = null;

  let transitions: { id: string; name: string }[] = [];
  let entities: { entity_id: string; state: string }[] = [];

  const HELPER_DOMAINS = new Set([
    'input_boolean',
    'input_number',
    'input_text',
    'input_select',
    'input_datetime',
    'input_button',
    'counter',
    'timer',
    'schedule',
  ]);

  function entityDomain(id: string): string {
    return id.split('.')[0] ?? '';
  }

  $: groupedEntities = (() => {
    const byDomain = new Map<string, { entity_id: string; state: string }[]>();
    for (const e of entities) {
      const d = entityDomain(e.entity_id);
      const arr = byDomain.get(d) ?? [];
      arr.push(e);
      byDomain.set(d, arr);
    }
    const helperDomains: string[] = [];
    const otherDomains: string[] = [];
    for (const d of byDomain.keys()) {
      (HELPER_DOMAINS.has(d) ? helperDomains : otherDomains).push(d);
    }
    helperDomains.sort();
    otherDomains.sort();
    return [...otherDomains, ...helperDomains].map((d) => ({
      domain: d,
      label: HELPER_DOMAINS.has(d) ? `${d} (helper)` : d,
      entities: (byDomain.get(d) ?? []).slice().sort((a, b) => a.entity_id.localeCompare(b.entity_id)),
    }));
  })();

  const FONT_FAMILIES = ['Inter', 'Fraunces', 'JetBrains Mono', 'Space Grotesk'];
  const FONT_SCALES = [0.8, 1.0, 1.25, 1.5, 2.0];
  const GRADIENT_SPEEDS = ['slow', 'medium', 'fast'] as const;
  const GRADIENT_STYLES = ['mesh', 'linear', 'radial'] as const;
  const GRADIENT_PRESETS: { name: string; colors: string[] }[] = [
    { name: 'Midnight', colors: ['#1a1a2e', '#16213e', '#0f3460'] },
    { name: 'Aurora', colors: ['#0b3d2e', '#1d6f5a', '#5fd3a3', '#a0e8af'] },
    { name: 'Sunset', colors: ['#ff6e7f', '#bfe9ff', '#ffb88c', '#ff5f6d'] },
    { name: 'Ocean', colors: ['#0f2027', '#203a43', '#2c5364', '#46a0c2'] },
    { name: 'Lavender Haze', colors: ['#3a1c71', '#6a3093', '#a044ff', '#d76d77'] },
    { name: 'Peach Glow', colors: ['#ffecd2', '#fcb69f', '#ff9a9e', '#fad0c4'] },
    { name: 'Forest', colors: ['#0a2818', '#1f4d2c', '#3d8050', '#7fb685'] },
    { name: 'Cyberpunk', colors: ['#240046', '#5a189a', '#ff006e', '#00f5d4'] },
    { name: 'Sand & Sky', colors: ['#fceabb', '#f8b500', '#7fb2f0', '#0a85ed'] },
    { name: 'Monochrome', colors: ['#0d0d0d', '#262626', '#595959', '#8c8c8c'] },
  ];

  function applyPreset(e: Event) {
    if (background.type !== 'gradient') return;
    const idx = Number((e.currentTarget as HTMLSelectElement).value);
    (e.currentTarget as HTMLSelectElement).value = '';
    const preset = GRADIENT_PRESETS[idx];
    if (!preset) return;
    background = { ...background, colors: [...preset.colors] };
  }
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
    if (background.colors.length <= 2) return; // gradient needs at least 2 colors
    background = { ...background, colors: background.colors.filter((_, i) => i !== idx) };
  }

  function centeredPosition(w: number, h: number) {
    const safeW = Math.min(w, layout.cols);
    const safeH = Math.min(h, layout.rows);
    return {
      col: Math.max(1, Math.floor((layout.cols - safeW) / 2) + 1),
      row: Math.max(1, Math.floor((layout.rows - safeH) / 2) + 1),
      w: safeW,
      h: safeH,
    };
  }

  function addWidget() {
    const newWidget = {
      id: crypto.randomUUID(),
      kind: 'clock' as WidgetKind,
      position: centeredPosition(4, 2),
      config: { format: '24h' } as Record<string, unknown>,
      data: null,
    };
    widgets = [...widgets, newWidget];
    selectedWidgetIdx = widgets.length - 1;
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
      <Field label="Preset" hint="Apply a curated palette">
        <select on:change={applyPreset}>
          <option value="">Choose preset…</option>
          {#each GRADIENT_PRESETS as p, i (p.name)}<option value={i}>{p.name}</option>{/each}
        </select>
      </Field>
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
      <p class="empty">No widgets yet — click <strong>+ Add widget</strong> to drop one in the middle of the canvas.</p>
    {:else}
      <WidgetCanvas
        {layout}
        bind:widgets
        selectedIndex={selectedWidgetIdx}
        onSelect={(i) => (selectedWidgetIdx = i)}
      />
      {#each widgets as w, i (w.id)}
        <div class="widget-card" class:selected={selectedWidgetIdx === i}>
          <div class="widget-row">
            <Field label="Kind">
              <select value={w.kind} on:change={(e) => setWidgetKind(i, e.currentTarget.value)}>
                {#each WIDGET_KINDS as k (k)}<option value={k}>{k}</option>{/each}
              </select>
            </Field>
            <Field label="Width">
              <input type="number" min="1" bind:value={w.position.w} />
            </Field>
            <Field label="Height">
              <input type="number" min="1" bind:value={w.position.h} />
            </Field>
            <button class="danger" type="button" on:click={() => { removeWidget(i); if (selectedWidgetIdx === i) selectedWidgetIdx = null; }}>Remove</button>
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
                <option value="">— Select entity —</option>
                {#each groupedEntities as g (g.domain)}
                  <optgroup label={g.label}>
                    {#each g.entities as e (e.entity_id)}<option value={e.entity_id}>{e.entity_id}</option>{/each}
                  </optgroup>
                {/each}
              </select>
              {#if entities.length === 0}<span class="hint">No entities cached. Set HA_URL/HA_TOKEN or add a real entity to your scene config.</span>{/if}
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
    transition: border-color 120ms ease;
  }
  .widget-card.selected {
    border-color: rgba(245, 158, 11, 0.6);
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
