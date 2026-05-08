<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';
  import WidgetCanvas from '$lib/admin/WidgetCanvas.svelte';
  import EntityPicker from '$lib/admin/EntityPicker.svelte';
  import type { Background, Typography, WidgetKind, WidgetState, Layout, MoodConfig } from '$lib/types';
  // Vite imports raw markdown as a string with the `?raw` suffix.
  import canvasHelpRaw from '$lib/admin/canvas-help.md?raw';
  // Tiny markdown → HTML pass: just paragraph + heading + code block + table.
  // Keeping it dependency-free; if you need full markdown later swap in
  // `marked` or similar.
  const canvasHelpHtml = canvasHelpRaw
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/```([\s\S]*?)```/g, (_, body) => `<pre><code>${body.trim().replace(/</g, '&lt;')}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\| (.+) \|$/gm, (line) => {
      if (/^\|[\s\-:|]+\|$/.test(line)) return '';
      return '<tr>' + line.slice(2, -2).split(' | ').map((c) => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/(\n<tr>.*<\/tr>)+/gs, (block) => `<table>${block}</table>`);

  function canvasTabHandler(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = e.currentTarget as HTMLTextAreaElement;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const v = ta.value;
    ta.value = v.slice(0, start) + '\t' + v.slice(end);
    ta.selectionStart = ta.selectionEnd = start + 1;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

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
  let selectedWidgetIdx: number | null = null;

  let transitions: { id: string; name: string }[] = [];
  let entities: { entity_id: string; state: string; attributes?: Record<string, unknown> }[] = [];
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
  const WIDGET_KINDS: WidgetKind[] = ['clock', 'weather', 'entity_tile', 'calendar', 'media_player', 'statistics', 'text', 'camera', 'canvas'];

  const WIDGET_KIND_LABELS: Record<WidgetKind, string> = {
    clock: 'Clock',
    weather: 'Weather',
    entity_tile: 'Entity tile',
    calendar: 'Calendar agenda',
    media_player: 'Media player',
    statistics: 'Statistics / history',
    text: 'Text',
    camera: 'Camera',
    canvas: 'Canvas (HTML/JS)',
  };

  /** Available secondary-info rows for the weather widget, in default
   *  display order. The user picks any subset and reorders them. */
  const WEATHER_SECONDARY_OPTIONS: { id: string; label: string }[] = [
    { id: 'temp_range',           label: 'High / Low (today)' },
    { id: 'humidity',             label: 'Humidity' },
    { id: 'pressure',             label: 'Pressure' },
    { id: 'wind_speed',           label: 'Wind speed' },
    { id: 'wind_bearing',         label: 'Wind bearing' },
    { id: 'visibility',           label: 'Visibility' },
    { id: 'cloud_coverage',       label: 'Cloud coverage' },
    { id: 'uv_index',             label: 'UV index' },
    { id: 'apparent_temperature', label: 'Feels like' },
    { id: 'dew_point',            label: 'Dew point' },
  ];
  function secondaryLabel(id: string): string {
    return WEATHER_SECONDARY_OPTIONS.find((o) => o.id === id)?.label ?? id;
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

  function duplicateWidget(idx: number) {
    const src = widgets[idx];
    if (!src) return;
    // Offset the copy so it doesn't sit directly on top of the original.
    // Try +1 col / +1 row first; fall back to centered position if that
    // would push the widget off-canvas.
    const desiredCol = src.position.col + 1;
    const desiredRow = src.position.row + 1;
    const fitsCol = desiredCol + src.position.w - 1 <= layout.cols;
    const fitsRow = desiredRow + src.position.h - 1 <= layout.rows;
    const nudged = fitsCol && fitsRow
      ? { ...src.position, col: desiredCol, row: desiredRow }
      : centeredPosition(src.position.w, src.position.h);
    const copy: Widget = {
      id: crypto.randomUUID(),
      kind: src.kind,
      position: nudged,
      // Deep-clone config so edits to the copy don't bleed back to the original.
      config: JSON.parse(JSON.stringify(src.config)) as Record<string, unknown>,
      data: null,
    };
    widgets = [...widgets, copy];
    selectedWidgetIdx = widgets.length - 1;
  }

  function firstEntityOfDomain(domain: string): string {
    const match = entities.find((e) => e.entity_id.startsWith(`${domain}.`));
    return match?.entity_id ?? '';
  }

  function setWidgetKind(idx: number, kind: string) {
    const w = { ...widgets[idx], kind: kind as WidgetKind };
    if (kind === 'clock') w.config = { format: '24h' };
    if (kind === 'weather') {
      w.config = {
        entity_id: firstEntityOfDomain('weather') || 'weather.home',
        forecast_type: 'daily',
        forecast_slots: 5,
        show_current: true,
        show_forecast: true,
        show_name: true,
        secondary_info_attribute: '',
        temperature_unit: 'auto',
        time_format: '24h',
        name: '',
      };
    }
    if (kind === 'entity_tile') w.config = { entity_id: entities[0]?.entity_id ?? '' };
    if (kind === 'calendar') {
      w.config = {
        entity_id: firstEntityOfDomain('calendar') || 'calendar.home',
        days_ahead: 2,
        max_events: 5,
        show_all_day: true,
        show_location: true,
        show_description: false,
        show_header: true,
        time_format: '24h',
        group_by_day: true,
        hide_past: true,
      };
    }
    if (kind === 'media_player') {
      w.config = {
        entity_id: firstEntityOfDomain('media_player') || 'media_player.living_room',
        show_album_art: true,
        show_title: true,
        show_artist: true,
        show_album: false,
        show_progress: true,
        show_controls: true,
        show_volume: false,
        show_source: false,
        blur_background: true,
        compact: false,
      };
    }
    if (kind === 'statistics') {
      w.config = {
        entity_id: firstEntityOfDomain('sensor') || 'sensor.outside_temp',
        hours_back: 24,
        show_current: true,
        show_min_max: true,
        show_unit: true,
        show_axis: false,
        show_area_fill: true,
        smoothing: true,
        chart_type: 'line',
        title: '',
        color: '',
      };
    }
    if (kind === 'text') {
      w.config = {
        content: 'Hello!',
        align: 'center',
        weight: '300',
      };
    }
    if (kind === 'camera') {
      w.config = {
        entity_id: firstEntityOfDomain('camera') || 'camera.front_door',
        view: 'auto',
        refresh_interval_s: 10,
        fit: 'cover',
        aspect_ratio: '',
        show_name: false,
        show_state: false,
        name: '',
      };
    }
    if (kind === 'canvas') {
      w.config = {
        content: '<div style="display:grid;place-items:center;width:100%;height:100%;font-family:system-ui;color:#f5f5f5">\n  <div>Hello, canvas!</div>\n</div>',
      };
    }
    widgets[idx] = w;
    widgets = widgets;
  }

  function configStr(cfg: Record<string, unknown>, key: string, fallback = ''): string {
    const v = cfg[key];
    return typeof v === 'string' ? v : fallback;
  }

  function configBool(cfg: Record<string, unknown>, key: string): boolean {
    return cfg[key] === true;
  }

  /** Read an ordered string list from a widget config. Falls back to a
   *  legacy singular field if `key` is missing — used for back-compat. */
  function configList(cfg: Record<string, unknown>, key: string, legacyKey?: string): string[] {
    const v = cfg[key];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x !== '');
    if (legacyKey) {
      const legacy = cfg[legacyKey];
      if (typeof legacy === 'string' && legacy !== '') return [legacy];
    }
    return [];
  }

  /** Mutate the widget's config to swap the order of two list items. */
  function moveListItem(idx: number, key: string, fromIdx: number, dir: -1 | 1): void {
    const cur = configList(widgets[idx].config, key);
    const target = fromIdx + dir;
    if (target < 0 || target >= cur.length) return;
    const next = [...cur];
    const tmp = next[target];
    next[target] = next[fromIdx];
    next[fromIdx] = tmp;
    widgets[idx].config = { ...widgets[idx].config, [key]: next };
    widgets = widgets;
  }
  function addToList(idx: number, key: string, value: string): void {
    if (!value) return;
    const cur = configList(widgets[idx].config, key);
    if (cur.includes(value)) return;
    widgets[idx].config = { ...widgets[idx].config, [key]: [...cur, value] };
    widgets = widgets;
  }
  function removeFromList(idx: number, key: string, value: string): void {
    const cur = configList(widgets[idx].config, key);
    widgets[idx].config = { ...widgets[idx].config, [key]: cur.filter((x) => x !== value) };
    widgets = widgets;
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
      {/if}
      <Field label="Preset" hint="Apply a curated palette">
        <select on:change={applyPreset} disabled={background.sun_adaptive === true}>
          <option value="">Choose preset…</option>
          {#each GRADIENT_PRESETS as p, i (p.name)}<option value={i}>{p.name}</option>{/each}
        </select>
      </Field>
      <Field label="Colors" hint="2–6 colors blend continuously">
        {#each background.colors as _, i}
          <div class="color-row">
            <input type="color" bind:value={background.colors[i]} disabled={background.sun_adaptive === true} />
            <button class="danger" type="button" on:click={() => removeColor(i)} disabled={background.sun_adaptive === true}>Remove</button>
          </div>
        {/each}
        <button type="button" on:click={addColor} disabled={background.sun_adaptive === true}>+ Color</button>
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
                {#each WIDGET_KINDS as k (k)}<option value={k}>{WIDGET_KIND_LABELS[k]}</option>{/each}
              </select>
            </Field>
            <Field label="Width">
              <input type="number" min="1" bind:value={w.position.w} />
            </Field>
            <Field label="Height">
              <input type="number" min="1" bind:value={w.position.h} />
            </Field>
            <button class="ghost" type="button" on:click={() => duplicateWidget(i)}>Duplicate</button>
            <button class="danger" type="button" on:click={() => { removeWidget(i); if (selectedWidgetIdx === i) selectedWidgetIdx = null; }}>Remove</button>
          </div>
          <Field label="Transparent background">
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={w.config.transparent === true}
                on:change={(e) => { w.config = { ...w.config, transparent: e.currentTarget.checked }; widgets = widgets; }}
              />
              <span>Hide the widget's card background — overlay content directly on the scene.</span>
            </label>
          </Field>
          <Field label="Corner radius">
            <div class="radius-row">
              <input
                type="range"
                min="0"
                max="3"
                step="0.05"
                value={typeof w.config.border_radius === 'number' ? w.config.border_radius : ''}
                on:input={(e) => { w.config = { ...w.config, border_radius: Number(e.currentTarget.value) }; widgets = widgets; }}
              />
              <span class="radius-value">
                {typeof w.config.border_radius === 'number' ? `${w.config.border_radius.toFixed(2)} rem` : 'default'}
              </span>
              {#if typeof w.config.border_radius === 'number'}
                <button type="button" class="ghost" on:click={() => { const { border_radius: _r, ...rest } = w.config; w.config = rest; widgets = widgets; }}>Reset</button>
              {/if}
            </div>
            <span class="hint">Affects widgets with a card surface (entity tile, media player). Reset clears the override and restores the per-theme default.</span>
          </Field>
          {#if w.kind === 'clock'}
            <Field label="Format">
              <select value={configStr(w.config, 'format', '24h')} on:change={(e) => { w.config = { ...w.config, format: e.currentTarget.value }; widgets = widgets; }}>
                <option value="24h">24h</option>
                <option value="12h">12h</option>
              </select>
            </Field>
            <Field label="Show seconds">
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  checked={configBool(w.config, 'show_seconds')}
                  on:change={(e) => { w.config = { ...w.config, show_seconds: e.currentTarget.checked }; widgets = widgets; }}
                />
                <span>Display seconds (ticks every second)</span>
              </label>
            </Field>
            {#if configStr(w.config, 'format', '24h') === '12h'}
              <Field label="Show AM/PM">
                <label class="checkbox-row">
                  <input
                    type="checkbox"
                    checked={w.config.show_ampm !== false}
                    on:change={(e) => { w.config = { ...w.config, show_ampm: e.currentTarget.checked }; widgets = widgets; }}
                  />
                  <span>Append AM or PM after the time</span>
                </label>
              </Field>
            {/if}
            <Field label="Show date">
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  checked={w.config.show_date !== false}
                  on:change={(e) => { w.config = { ...w.config, show_date: e.currentTarget.checked }; widgets = widgets; }}
                />
                <span>Display the date below the time</span>
              </label>
            </Field>
            <div class="inline-fields">
              <Field label="Font (override)">
                <select
                  value={configStr(w.config, 'font_family')}
                  on:change={(e) => { w.config = { ...w.config, font_family: e.currentTarget.value }; widgets = widgets; }}
                >
                  <option value="">— Use scene font —</option>
                  {#each FONT_FAMILIES as f (f)}<option value={f}>{f}</option>{/each}
                </select>
              </Field>
              <Field label="Weight (override)">
                <select
                  value={configStr(w.config, 'font_weight')}
                  on:change={(e) => { w.config = { ...w.config, font_weight: e.currentTarget.value }; widgets = widgets; }}
                >
                  <option value="">— Default —</option>
                  <option value="100">100 · Thin</option>
                  <option value="200">200 · ExtraLight</option>
                  <option value="300">300 · Light</option>
                  <option value="400">400 · Regular</option>
                  <option value="500">500 · Medium</option>
                  <option value="600">600 · Semibold</option>
                  <option value="700">700 · Bold</option>
                  <option value="800">800 · Extrabold</option>
                  <option value="900">900 · Black</option>
                </select>
              </Field>
            </div>
            <span class="hint">Per-clock typography overrides the scene's typography for this widget only.</span>
          {:else if w.kind === 'weather'}
            <Field label="Weather entity">
              <EntityPicker
                value={configStr(w.config, 'entity_id')}
                entities={entities.filter((e) => e.entity_id.startsWith('weather.'))}
                placeholder="Search weather entities…"
                on:change={(e) => { w.config = { ...w.config, entity_id: e.detail }; widgets = widgets; }}
              />
              <span class="hint">Falls back to mock data when HA isn't connected.</span>
            </Field>
            <Field label="Name override">
              <input type="text" placeholder="(use entity friendly name)" value={configStr(w.config, 'name')} on:input={(e) => { w.config = { ...w.config, name: e.currentTarget.value }; widgets = widgets; }} />
            </Field>
            <div class="inline-fields">
              <Field label="Forecast type">
                <select value={configStr(w.config, 'forecast_type', 'daily')} on:change={(e) => { w.config = { ...w.config, forecast_type: e.currentTarget.value }; widgets = widgets; }}>
                  <option value="daily">Daily</option>
                  <option value="hourly">Hourly</option>
                  <option value="twice_daily">Twice daily</option>
                </select>
              </Field>
              <Field label="Forecast slots">
                <input type="number" min="1" max="12" value={w.config.forecast_slots ?? 5} on:input={(e) => { w.config = { ...w.config, forecast_slots: Number(e.currentTarget.value) }; widgets = widgets; }} />
              </Field>
              <Field label="Temperature unit">
                <select value={configStr(w.config, 'temperature_unit', 'auto')} on:change={(e) => { w.config = { ...w.config, temperature_unit: e.currentTarget.value }; widgets = widgets; }}>
                  <option value="auto">Auto (entity)</option>
                  <option value="C">Celsius</option>
                  <option value="F">Fahrenheit</option>
                </select>
              </Field>
              {#if configStr(w.config, 'forecast_type', 'daily') === 'hourly'}
                <Field label="Time format">
                  <select value={configStr(w.config, 'time_format', '24h')} on:change={(e) => { w.config = { ...w.config, time_format: e.currentTarget.value }; widgets = widgets; }}>
                    <option value="24h">24h</option>
                    <option value="12h">12h</option>
                  </select>
                </Field>
              {/if}
            </div>
            <Field label="Secondary info">
              {@const selected = configList(w.config, 'secondary_info_attributes', 'secondary_info_attribute')}
              {@const available = WEATHER_SECONDARY_OPTIONS.filter((o) => !selected.includes(o.id))}
              <span class="hint">Pick any number of stats to show under the current conditions, in priority order. Drag the ↑/× buttons to reorder.</span>
              <div class="secondary-pickers">
                <div class="picker-col">
                  <h5>Available</h5>
                  {#if available.length === 0}
                    <p class="hint">All options selected.</p>
                  {:else}
                    <ul class="picker-list">
                      {#each available as o (o.id)}
                        <li>
                          <button type="button" on:click={() => addToList(i, 'secondary_info_attributes', o.id)}>+ {o.label}</button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
                <div class="picker-col">
                  <h5>Showing (priority order)</h5>
                  {#if selected.length === 0}
                    <p class="hint">Add rows from the left.</p>
                  {:else}
                    <ol class="picker-list ordered">
                      {#each selected as id, k (id)}
                        <li>
                          <span class="seq">{k + 1}.</span>
                          <span class="name">{secondaryLabel(id)}</span>
                          <button class="ghost" type="button" on:click={() => moveListItem(i, 'secondary_info_attributes', k, -1)} disabled={k === 0}>↑</button>
                          <button class="ghost danger" type="button" on:click={() => removeFromList(i, 'secondary_info_attributes', id)}>×</button>
                        </li>
                      {/each}
                    </ol>
                  {/if}
                </div>
              </div>
            </Field>
            <div class="checkboxes">
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_current !== false} on:change={(e) => { w.config = { ...w.config, show_current: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show current conditions</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_forecast !== false} on:change={(e) => { w.config = { ...w.config, show_forecast: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show forecast</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_name !== false} on:change={(e) => { w.config = { ...w.config, show_name: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show name</span>
              </label>
            </div>
          {:else if w.kind === 'entity_tile'}
            <Field label="Entity">
              <EntityPicker
                value={configStr(w.config, 'entity_id')}
                {entities}
                placeholder="Search any entity…"
                on:change={(e) => { w.config = { ...w.config, entity_id: e.detail }; widgets = widgets; }}
              />
            </Field>

          {:else if w.kind === 'calendar'}
            <Field label="Calendar entity">
              <EntityPicker
                value={configStr(w.config, 'entity_id')}
                entities={entities.filter((e) => e.entity_id.startsWith('calendar.'))}
                placeholder="Search calendars…"
                on:change={(e) => { w.config = { ...w.config, entity_id: e.detail }; widgets = widgets; }}
              />
              <span class="hint">Falls back to mock events when HA isn't connected.</span>
            </Field>
            <div class="inline-fields">
              <Field label="Days ahead">
                <select value={String(w.config.days_ahead ?? 2)} on:change={(e) => { w.config = { ...w.config, days_ahead: Number(e.currentTarget.value) }; widgets = widgets; }}>
                  <option value="1">Today only</option>
                  <option value="2">Today + tomorrow</option>
                  <option value="3">3 days</option>
                  <option value="7">1 week</option>
                  <option value="14">2 weeks</option>
                  <option value="30">1 month</option>
                </select>
              </Field>
              <Field label="Max events">
                <input type="number" min="1" max="50" value={w.config.max_events ?? 5} on:input={(e) => { w.config = { ...w.config, max_events: Number(e.currentTarget.value) }; widgets = widgets; }} />
              </Field>
              <Field label="Time format">
                <select value={configStr(w.config, 'time_format', '24h')} on:change={(e) => { w.config = { ...w.config, time_format: e.currentTarget.value }; widgets = widgets; }}>
                  <option value="24h">24h</option>
                  <option value="12h">12h</option>
                </select>
              </Field>
            </div>
            <div class="checkboxes">
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_header !== false} on:change={(e) => { w.config = { ...w.config, show_header: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show header (calendar name + count)</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_all_day !== false} on:change={(e) => { w.config = { ...w.config, show_all_day: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show all-day events</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_location !== false} on:change={(e) => { w.config = { ...w.config, show_location: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show location</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_description === true} on:change={(e) => { w.config = { ...w.config, show_description: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show description</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.group_by_day !== false} on:change={(e) => { w.config = { ...w.config, group_by_day: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Group by day</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.hide_past !== false} on:change={(e) => { w.config = { ...w.config, hide_past: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Hide past events (today)</span>
              </label>
            </div>

          {:else if w.kind === 'media_player'}
            <Field label="Media player entity">
              <EntityPicker
                value={configStr(w.config, 'entity_id')}
                entities={entities.filter((e) => e.entity_id.startsWith('media_player.'))}
                placeholder="Search media players…"
                on:change={(e) => { w.config = { ...w.config, entity_id: e.detail }; widgets = widgets; }}
              />
            </Field>
            <Field label="Theme" hint="Visual style for the player">
              <select value={configStr(w.config, 'theme', 'default')} on:change={(e) => { w.config = { ...w.config, theme: e.currentTarget.value }; widgets = widgets; }}>
                <option value="default">Default — horizontal art + info</option>
                <option value="cinematic">Cinematic — full-bleed art with overlay</option>
                <option value="card">Card — bold vertical layout</option>
                <option value="vinyl">Vinyl — sleeve with spinning record</option>
              </select>
            </Field>
            <div class="checkboxes">
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_album_art !== false} on:change={(e) => { w.config = { ...w.config, show_album_art: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show album art</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_title !== false} on:change={(e) => { w.config = { ...w.config, show_title: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show title</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_artist !== false} on:change={(e) => { w.config = { ...w.config, show_artist: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show artist</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_album === true} on:change={(e) => { w.config = { ...w.config, show_album: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show album name</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_progress !== false} on:change={(e) => { w.config = { ...w.config, show_progress: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show progress bar &amp; times</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_controls !== false} on:change={(e) => { w.config = { ...w.config, show_controls: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show transport controls (play/next/prev)</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_volume === true} on:change={(e) => { w.config = { ...w.config, show_volume: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show volume</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_source === true} on:change={(e) => { w.config = { ...w.config, show_source: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show source / app name (Spotify, Plex, …)</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.blur_background !== false} on:change={(e) => { w.config = { ...w.config, blur_background: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Blur album art behind the widget</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.compact === true} on:change={(e) => { w.config = { ...w.config, compact: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Compact layout (smaller art, denser text)</span>
              </label>
            </div>

          {:else if w.kind === 'statistics'}
            <Field label="Sensor entity">
              <EntityPicker
                value={configStr(w.config, 'entity_id')}
                entities={entities.filter((e) => e.entity_id.startsWith('sensor.') || e.entity_id.startsWith('input_number.') || e.entity_id.startsWith('counter.'))}
                placeholder="Search sensors…"
                on:change={(e) => { w.config = { ...w.config, entity_id: e.detail }; widgets = widgets; }}
              />
              <span class="hint">Numeric entities only (sensors, input_numbers, counters).</span>
            </Field>
            <div class="inline-fields">
              <Field label="History window">
                <select value={String(w.config.hours_back ?? 24)} on:change={(e) => { w.config = { ...w.config, hours_back: Number(e.currentTarget.value) }; widgets = widgets; }}>
                  <option value="1">Last hour</option>
                  <option value="6">Last 6 hours</option>
                  <option value="12">Last 12 hours</option>
                  <option value="24">Last 24 hours</option>
                  <option value="48">Last 2 days</option>
                  <option value="168">Last 7 days</option>
                </select>
              </Field>
              <Field label="Chart type">
                <select value={configStr(w.config, 'chart_type', 'line')} on:change={(e) => { w.config = { ...w.config, chart_type: e.currentTarget.value }; widgets = widgets; }}>
                  <option value="line">Line</option>
                  <option value="bar">Bar</option>
                </select>
              </Field>
              <Field label="Custom title">
                <input type="text" placeholder="(uses entity friendly name)" value={configStr(w.config, 'title')} on:input={(e) => { w.config = { ...w.config, title: e.currentTarget.value }; widgets = widgets; }} />
              </Field>
              <Field label="Line color">
                <input type="color" value={configStr(w.config, 'color', '#f3a26a')} on:input={(e) => { w.config = { ...w.config, color: e.currentTarget.value }; widgets = widgets; }} />
              </Field>
            </div>
            <div class="checkboxes">
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_current !== false} on:change={(e) => { w.config = { ...w.config, show_current: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show current value</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_min_max !== false} on:change={(e) => { w.config = { ...w.config, show_min_max: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show min &amp; max for the period</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_unit !== false} on:change={(e) => { w.config = { ...w.config, show_unit: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show unit of measurement</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_axis === true} on:change={(e) => { w.config = { ...w.config, show_axis: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show chart axes</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_area_fill !== false} on:change={(e) => { w.config = { ...w.config, show_area_fill: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Fill area under the line</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.smoothing !== false} on:change={(e) => { w.config = { ...w.config, smoothing: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Smooth the line (Bézier curves)</span>
              </label>
            </div>
          {:else if w.kind === 'text'}
            <Field label="Content">
              <textarea
                rows="4"
                class="text-content-input"
                placeholder="Type any text. It wraps automatically."
                value={configStr(w.config, 'content')}
                on:input={(e) => { w.config = { ...w.config, content: e.currentTarget.value }; widgets = widgets; }}
              ></textarea>
              <span class="hint">Line breaks are preserved. Font size scales to fit the widget cell.</span>
            </Field>
            <div class="inline-fields">
              <Field label="Alignment">
                <select value={configStr(w.config, 'align', 'center')} on:change={(e) => { w.config = { ...w.config, align: e.currentTarget.value }; widgets = widgets; }}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </Field>
              <Field label="Weight">
                <select value={configStr(w.config, 'weight', '300')} on:change={(e) => { w.config = { ...w.config, weight: e.currentTarget.value }; widgets = widgets; }}>
                  <option value="200">Thin</option>
                  <option value="300">Light</option>
                  <option value="400">Regular</option>
                  <option value="600">Semibold</option>
                  <option value="700">Bold</option>
                </select>
              </Field>
            </div>
          {:else if w.kind === 'camera'}
            <Field label="Camera entity">
              <EntityPicker
                value={configStr(w.config, 'entity_id')}
                entities={entities.filter((e) => e.entity_id.startsWith('camera.'))}
                placeholder="Search cameras…"
                on:change={(e) => { w.config = { ...w.config, entity_id: e.detail }; widgets = widgets; }}
              />
              <span class="hint">Streams via Cosmos's media proxy — no HA token needed in the browser.</span>
            </Field>
            <Field label="Name override">
              <input type="text" placeholder="(use entity friendly name)" value={configStr(w.config, 'name')} on:input={(e) => { w.config = { ...w.config, name: e.currentTarget.value }; widgets = widgets; }} />
            </Field>
            <div class="inline-fields">
              <Field label="View" hint="Auto polls a still snapshot; Live streams MJPEG continuously.">
                <select value={configStr(w.config, 'view', 'auto')} on:change={(e) => { w.config = { ...w.config, view: e.currentTarget.value }; widgets = widgets; }}>
                  <option value="auto">Auto (snapshot)</option>
                  <option value="live">Live (MJPEG)</option>
                </select>
              </Field>
              {#if configStr(w.config, 'view', 'auto') === 'auto'}
                <Field label="Refresh (s)" hint="How often to refetch the snapshot">
                  <input type="number" min="1" max="3600" value={typeof w.config.refresh_interval_s === 'number' ? w.config.refresh_interval_s : 10} on:input={(e) => { w.config = { ...w.config, refresh_interval_s: Math.max(1, Number(e.currentTarget.value) || 10) }; widgets = widgets; }} />
                </Field>
              {/if}
              <Field label="Fit">
                <select value={configStr(w.config, 'fit', 'cover')} on:change={(e) => { w.config = { ...w.config, fit: e.currentTarget.value }; widgets = widgets; }}>
                  <option value="cover">Cover (crop to fill)</option>
                  <option value="contain">Contain (letterbox)</option>
                  <option value="fill">Fill (stretch)</option>
                </select>
              </Field>
              <Field label="Aspect ratio" hint="e.g. 16:9, 4:3 — blank to fill the cell">
                <input type="text" placeholder="(none)" value={configStr(w.config, 'aspect_ratio')} on:input={(e) => { w.config = { ...w.config, aspect_ratio: e.currentTarget.value }; widgets = widgets; }} />
              </Field>
            </div>
            <div class="checkboxes">
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_name === true} on:change={(e) => { w.config = { ...w.config, show_name: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show name overlay</span>
              </label>
              <label class="checkbox-row">
                <input type="checkbox" checked={w.config.show_state === true} on:change={(e) => { w.config = { ...w.config, show_state: e.currentTarget.checked }; widgets = widgets; }} />
                <span>Show state badge (idle / recording / streaming)</span>
              </label>
            </div>
          {:else if w.kind === 'canvas'}
            <Field label="Name (optional)">
              <input
                type="text"
                placeholder="e.g. kitchen-power, news-headlines, garden-cam"
                value={configStr(w.config, 'name')}
                on:input={(e) => { w.config = { ...w.config, name: e.currentTarget.value }; widgets = widgets; }}
              />
              <span class="hint">A short label so you (and your LLM agent) can refer to this canvas by name later — "edit the news-headlines canvas" instead of "the canvas with id abc123".</span>
            </Field>
            <Field label="Content (HTML / CSS / JS)">
              <div class="canvas-editor-toolbar">
                <span
                  class="help-tip"
                  tabindex="0"
                  role="button"
                  aria-label="How this works"
                  aria-describedby="canvas-help-tooltip-{i}"
                >
                  ⓘ How this works
                  <span class="help-tooltip" id="canvas-help-tooltip-{i}" role="tooltip">
                    {@html canvasHelpHtml}
                  </span>
                </span>
              </div>
              <textarea
                rows="14"
                class="canvas-content"
                placeholder="Type or paste HTML/CSS/JS. Use {'{{'} states('sensor.foo') {'}}'} for live values."
                value={configStr(w.config, 'content')}
                on:input={(e) => { w.config = { ...w.config, content: e.currentTarget.value }; widgets = widgets; }}
                on:keydown={canvasTabHandler}
              ></textarea>
              <span class="hint">{configStr(w.config, 'content').length.toLocaleString()} chars · soft limit ~50,000.</span>
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
  .radius-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .radius-row input[type='range'] {
    flex: 1;
    min-width: 8rem;
    max-width: 18rem;
  }
  .radius-value {
    color: #ccc;
    font-variant-numeric: tabular-nums;
    min-width: 5rem;
    text-align: right;
  }

  /* Two-column picker for the weather widget's secondary-info list. */
  .secondary-pickers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  @media (max-width: 720px) {
    .secondary-pickers { grid-template-columns: 1fr; }
  }
  .picker-col h5 {
    margin: 0 0 0.5rem;
    font-size: 0.78rem;
    color: #aaa;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
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
    background: transparent;
    color: #ccc;
    border: 1px solid #2a2a2a;
    border-radius: 0.3rem;
    cursor: pointer;
    font-family: inherit;
  }
  .picker-list button.ghost.danger { color: #ff8a8a; border-color: #3a2222; }
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

  input, select, textarea {
    background: #0a0a0a;
    color: #eee;
    border: 1px solid #2a2a2a;
    border-radius: 0.4rem;
    padding: 0.5rem 0.65rem;
    font-size: 0.95rem;
    font-family: inherit;
  }
  textarea.text-content-input {
    width: 100%;
    resize: vertical;
    min-height: 5rem;
    line-height: 1.4;
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
  button.ghost {
    background: transparent;
    color: #ccc;
    border: 1px solid #2a2a2a;
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
  .checkboxes {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  @media (min-width: 600px) {
    .checkboxes { grid-template-columns: repeat(2, 1fr); }
  }
  .inline-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.75rem;
    margin: 0.5rem 0;
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
  .canvas-editor-toolbar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  textarea.canvas-content {
    width: 100%;
    min-height: 14rem;
    max-height: 40rem;
    resize: vertical;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.85rem;
    line-height: 1.5;
    tab-size: 2;
  }
  .help-tip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.55rem;
    border-radius: 999px;
    font-size: 0.82rem;
    color: var(--c-fg-2);
    cursor: help;
    user-select: none;
    border: 1px solid var(--c-line);
    background: var(--c-surface);
  }
  .help-tip:hover, .help-tip:focus-visible { color: var(--c-fg); outline: none; }
  .help-tooltip {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    z-index: 30;
    width: min(28rem, 80vw);
    max-height: 24rem;
    overflow-y: auto;
    padding: 0.85rem 1rem;
    background: #0e0e0e;
    color: #ccc;
    border: 1px solid #2a2a2a;
    border-radius: 0.5rem;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    font-size: 0.85rem;
    line-height: 1.55;
    cursor: default;
    opacity: 0;
    visibility: hidden;
    transform: translateY(-4px);
    transition: opacity 150ms var(--ease), transform 150ms var(--ease), visibility 0s linear 150ms;
    pointer-events: none;
  }
  .help-tip:hover .help-tooltip,
  .help-tip:focus-visible .help-tooltip,
  .help-tooltip:hover {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
    transition-delay: 0s;
    pointer-events: auto;
  }
  .help-tooltip h1 { font-size: 1rem; margin: 0.1rem 0 0.4rem; color: #f0f0f0; }
  .help-tooltip h2 { font-size: 0.9rem; margin: 0.6rem 0 0.3rem; color: #e5e5e5; }
  .help-tooltip h3 { font-size: 0.85rem; margin: 0.5rem 0 0.25rem; color: #ddd; }
  .help-tooltip table { width: 100%; border-collapse: collapse; margin: 0.4rem 0; font-size: 0.8rem; }
  .help-tooltip td { padding: 0.2rem 0.4rem; border-bottom: 1px solid #2a2a2a; vertical-align: top; }
  .help-tooltip code, .help-tooltip pre {
    background: #1a1a1a;
    padding: 0.05rem 0.3rem;
    border-radius: 0.25rem;
    font-family: ui-monospace, monospace;
  }
  .help-tooltip pre { padding: 0.6rem 0.85rem; overflow-x: auto; }
</style>
