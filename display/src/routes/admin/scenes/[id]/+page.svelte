<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';
  import WidgetEditor from '$lib/admin/WidgetEditor.svelte';
  import EntityPicker from '$lib/admin/EntityPicker.svelte';
  import type { Background, Typography, WidgetState, Layout, MoodConfig, EntityState } from '$lib/types';

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
  let floatWidgets = false;
  let mood: MoodConfig = { enabled: false, strategy: 'manual' };
  let widgets: Widget[] = [];

  let transitions: { id: string; name: string }[] = [];
  let entities: EntityState[] = [];
  let moodCatalog: { id: string; label: string; tags: string[] }[] = [];

  $: weatherEntities = entities.filter((e) => e.entity_id.startsWith('weather.'));

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
  const FONT_SCALES = [0.8, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0];
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

  $: isNew = id === 'new';

  onMount(async () => {
    const [txns, ents, moods] = await Promise.all([
      api.transitions.list(),
      api.ha.listEntities(),
      api.moods.list(),
    ]);
    transitions = txns;
    entities = ents;
    moodCatalog = moods;

    if (isNew) {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      name = `New scene · ${stamp}`;
      loaded = true;
      return;
    }

    const scene = await api.scenes.get(id);
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
    floatWidgets = scene.floatWidgets ?? false;
    mood = { opacity: 1, ...(scene.mood ?? { enabled: false, strategy: 'manual' }) };
    widgets = scene.widgets;
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

  function cleanMood(m: MoodConfig): MoodConfig {
    const out: MoodConfig = { enabled: m.enabled, strategy: m.strategy };
    if (m.strategy === 'manual' && m.moodId) out.moodId = m.moodId;
    if (m.strategy === 'weather' && m.weatherEntity) out.weatherEntity = m.weatherEntity;
    const op = typeof m.opacity === 'number' ? m.opacity : 1;
    out.opacity = Math.max(0, Math.min(1, op));
    return out;
  }

  async function save() {
    saving = true;
    saveStatus = null;
    try {
      // Strip the `data` field (server doesn't accept it on input)
      const widgetsForSave = widgets.map(({ data: _data, ...rest }) => rest);
      const payload = {
        name,
        layout,
        background,
        typography,
        defaultTransitionId,
        floatWidgets,
        mood: cleanMood(mood),
        widgets: widgetsForSave,
      };
      if (isNew) {
        const created = await api.scenes.create(payload);
        saveStatus = 'saved';
        goto(`/admin/scenes/${created.id}`, { replaceState: true });
      } else {
        await api.scenes.update(id, payload);
        saveStatus = 'saved';
      }
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
    <Field label="Float widgets" hint="Gentle bob animation; respects prefers-reduced-motion">
      <label class="checkbox-row">
        <input type="checkbox" bind:checked={floatWidgets} />
        <span>Enable floating motion</span>
      </label>
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
    <Field label="Auto-contrast text">
      <label class="inline-check">
        <input
          type="checkbox"
          checked={background.auto_contrast === true}
          on:change={(e) => { background = { ...background, auto_contrast: e.currentTarget.checked }; }}
        />
        <span>Switch widget text to black or white based on the background's luminance. Most useful with light backgrounds where white text disappears.</span>
      </label>
    </Field>
    {#if background.type === 'solid'}
      <Field label="Color">
        <input type="color" bind:value={background.color} />
      </Field>
    {:else}
      <Field label="Adapt to time of day">
        <label class="inline-check">
          <input
            type="checkbox"
            checked={background.sun_adaptive === true}
            on:change={(e) => { if (background.type === 'gradient') { background = { ...background, sun_adaptive: e.currentTarget.checked }; } }}
          />
          <span>Auto-pick the palette from <code>sun.sun</code> — sunrise / day / evening / night each get their own.</span>
        </label>
      </Field>
      <Field label="Adapt to widget colors">
        <label class="inline-check">
          <input
            type="checkbox"
            checked={background.adaptive_colors === true}
            on:change={(e) => { if (background.type === 'gradient') { background = { ...background, adaptive_colors: e.currentTarget.checked }; } }}
          />
          <span>Pull live colors from album art and canvas widgets. Falls back to the colors above when nothing is reporting. Stacks with sun-adaptive.</span>
        </label>
      </Field>
      {#if background.sun_adaptive}
        <p class="hint">
          Sunrise: warm peach · Day: peach glow · Evening: lavender · Night: midnight blue.
          The colors below are ignored while this is on.
        </p>
      {:else if background.adaptive_colors}
        <p class="hint">
          Disabled while <strong>Adapt to widget colors</strong> is on. These are used as fallback colors when nothing is reporting.
        </p>
      {/if}
      <Field label="Preset" hint="Apply a curated palette">
        <select on:change={applyPreset} disabled={background.sun_adaptive === true || background.adaptive_colors === true}>
          <option value="">Choose preset…</option>
          {#each GRADIENT_PRESETS as p, i (p.name)}<option value={i}>{p.name}</option>{/each}
        </select>
      </Field>
      <Field label="Colors" hint="2–6 colors blend continuously">
        {#each background.colors as _, i}
          <div class="color-row">
            <input type="color" bind:value={background.colors[i]} disabled={background.sun_adaptive === true || background.adaptive_colors === true} />
            <button class="danger" type="button" on:click={() => removeColor(i)} disabled={background.sun_adaptive === true || background.adaptive_colors === true}>Remove</button>
          </div>
        {/each}
        <button type="button" on:click={addColor} disabled={background.sun_adaptive === true || background.adaptive_colors === true}>+ Color</button>
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
    <h2>Mood</h2>
    <p class="panel-hint">Adds a looping video atmosphere over the background. Videos use a black background and screen-blend, so the brighter parts (clouds, rain, embers) glow over your scene.</p>
    <Field label="Enable mood layer">
      <label class="inline-check">
        <input type="checkbox" bind:checked={mood.enabled} />
        <span>{mood.enabled ? 'On' : 'Off'}</span>
      </label>
    </Field>
    {#if mood.enabled}
      <Field label="Strategy">
        <select bind:value={mood.strategy}>
          <option value="manual">Pick one mood</option>
          <option value="time">Auto by time of day</option>
          <option value="weather">Auto by weather</option>
        </select>
      </Field>

      {#if mood.strategy === 'manual'}
        <Field label="Mood">
          <select bind:value={mood.moodId}>
            <option value="">Select…</option>
            {#each moodCatalog as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
          </select>
        </Field>
      {:else if mood.strategy === 'time'}
        <p class="panel-hint">
          Uses Home Assistant's <code>sun.sun</code> entity. Sunrise mood plays within 45 min of dawn,
          embers within 45 min of dusk, clouds during the day, stars at night. Falls back to local
          clock when HA is disabled.
        </p>
      {:else if mood.strategy === 'weather'}
        <Field label="Weather entity">
          <EntityPicker
            value={mood.weatherEntity ?? ''}
            entities={weatherEntities}
            placeholder="Search weather entities…"
            on:change={(e) => { mood = { ...mood, weatherEntity: e.detail || undefined }; }}
          />
        </Field>
        {#if weatherEntities.length === 0}
          <p class="panel-hint">No <code>weather.*</code> entities found in HA. Add one to use this strategy.</p>
        {/if}
      {/if}

      <Field label="Opacity">
        <div class="opacity-row">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={mood.opacity}
          />
          <span class="opacity-value">{Math.round((mood.opacity ?? 1) * 100)}%</span>
        </div>
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
    <Field label="Text color" hint="Overrides background auto-contrast. Leave unset to use auto-contrast or the kiosk default.">
      <div class="color-row">
        <input
          type="color"
          value={typography.color ?? '#f5f5f5'}
          on:input={(e) => { typography = { ...typography, color: e.currentTarget.value }; }}
        />
        {#if typography.color}
          <button
            type="button"
            on:click={() => { const { color: _drop, ...rest } = typography; typography = rest; }}
          >Clear</button>
        {/if}
      </div>
    </Field>
  </section>

  <section class="panel">
    <header class="panel-header">
      <h2>Widgets</h2>
    </header>
    <WidgetEditor bind:widgets {layout} {entities} />
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
  .panel-hint {
    color: #999;
    font-size: 0.85rem;
    margin: 0 0 0.85rem;
    line-height: 1.45;
  }
  .panel-hint code {
    background: #0a0a0a;
    padding: 0.05rem 0.35rem;
    border-radius: 0.25rem;
    font-size: 0.85em;
  }
  .inline-check {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: #ccc;
  }
  .opacity-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .opacity-row input[type='range'] {
    flex: 1;
    min-width: 8rem;
    max-width: 18rem;
  }
  .opacity-value {
    color: #ccc;
    font-variant-numeric: tabular-nums;
    min-width: 3.25rem;
    text-align: right;
  }
  input, select, textarea {
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
  .checkbox-row {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.95rem;
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
</style>
