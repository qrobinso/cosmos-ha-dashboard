<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Field from '$lib/admin/Field.svelte';
  import Section from '$lib/admin/widgets/Section.svelte';
  import { widgetIconSvg } from '$lib/admin/widgetIcons';
  import { widgetKinds, widgetKindOrder } from '$lib/admin/widgetKinds';
  import { configComponents } from '$lib/admin/widgets';
  import type { EntityState, Layout, WidgetKind, WidgetState } from '$lib/types';

  /** The selected widget, or null for the empty state. Two-way bound so
   *  config / position edits flow straight back to the editor's array.
   *  When this is null the editor must NOT use `bind:` (Svelte can't bind to
   *  `widgets[null]`) — it renders the empty variant unconditionally instead. */
  export let widget: WidgetState | null = null;
  export let layout: Layout;
  export let entities: EntityState[] = [];

  const dispatch = createEventDispatcher<{
    retype: { kind: WidgetKind };
    duplicate: void;
    delete: void;
  }>();

  let confirmingDelete = false;

  $: meta = widget ? widgetKinds[widget.kind] : null;
  $: name = widget ? String((widget.config as { name?: unknown }).name ?? '') : '';

  // All edits reassign `widget` so the editor's `bind:widget={widgets[i]}`
  // (which invalidates the array slot on child reassignment) propagates.
  function patchConfig(patch: Record<string, unknown>) {
    if (!widget) return;
    widget = { ...widget, config: { ...widget.config, ...patch } };
  }
  function setName(v: string) {
    patchConfig({ name: v });
  }

  function clamp(n: number, min: number, max: number): number {
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  // Placement: clamp so the widget stays fully inside the layout. Editing w/h
  // first, then re-clamping col/row, mirrors the canvas drag-resize behavior.
  function setPos(key: 'col' | 'row' | 'w' | 'h', raw: number) {
    if (!widget) return;
    const p = { ...widget.position };
    if (key === 'w') p.w = clamp(raw, 1, layout.cols);
    else if (key === 'h') p.h = clamp(raw, 1, layout.rows);
    else if (key === 'col') p.col = clamp(raw, 1, layout.cols);
    else p.row = clamp(raw, 1, layout.rows);
    p.col = clamp(p.col, 1, layout.cols - p.w + 1);
    p.row = clamp(p.row, 1, layout.rows - p.h + 1);
    widget = { ...widget, position: p };
  }

  function onRetype(e: Event) {
    const kind = (e.currentTarget as HTMLSelectElement).value as WidgetKind;
    dispatch('retype', { kind });
  }

  function reqDelete() {
    if (confirmingDelete) {
      confirmingDelete = false;
      dispatch('delete');
    } else {
      confirmingDelete = true;
      setTimeout(() => (confirmingDelete = false), 3500);
    }
  }

  function setRadius(v: number) {
    patchConfig({ border_radius: v });
  }
  function clearRadius() {
    if (!widget) return;
    const { border_radius: _r, ...rest } = widget.config;
    widget = { ...widget, config: rest };
  }
</script>

{#if !widget || !meta}
  <div class="empty">
    <div class="empty-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke-dasharray="2 3" />
        <path d="M12 8.5v7M8.5 12h7" />
      </svg>
    </div>
    <p>Select a widget, or drag one from the palette to add it.</p>
  </div>
{:else}
  <div class="inspector">
    <header class="head">
      <span class="ic" style="--ic-accent: {meta.accent}">{@html widgetIconSvg(widget.kind, 18)}</span>
      <input
        class="name-in"
        type="text"
        placeholder={meta.label}
        value={name}
        on:input={(e) => setName(e.currentTarget.value)}
        aria-label="Widget name"
      />
      <span class="tag muted">{meta.label}</span>
    </header>
    <div class="head-actions">
      <button type="button" class="ghost sm" on:click={() => dispatch('duplicate')}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
        Duplicate
      </button>
      <button type="button" class="danger sm" class:armed={confirmingDelete} on:click={reqDelete}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 11v5M14 11v5M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>
        {confirmingDelete ? 'Confirm delete' : 'Delete'}
      </button>
    </div>

    <div class="body">
      <Section label="Type">
        <Field label="Widget kind" hint="Changing this resets the config to that kind's defaults.">
          <select value={widget.kind} on:change={onRetype}>
            {#each widgetKindOrder as k (k)}<option value={k}>{widgetKinds[k].label}</option>{/each}
          </select>
        </Field>
      </Section>

      <div class="kind-fields">
        {#key widget.id + widget.kind}
          <svelte:component this={configComponents[widget.kind]} bind:config={widget.config} {entities} />
        {/key}
      </div>

      <Section label="Surface">
        <Field label="Transparent background">
          <label class="check-row">
            <input type="checkbox" checked={widget.config.transparent === true} on:change={(e) => patchConfig({ transparent: e.currentTarget.checked })} />
            <span>Hide the widget's card background — overlay content directly on the scene.</span>
          </label>
        </Field>
        <Field label="Corner radius" hint="Affects widgets with a card surface (entity tile, media player). Reset restores the per-theme default.">
          <div class="radius-row">
            <input
              type="range"
              min="0"
              max="3"
              step="0.05"
              value={typeof widget.config.border_radius === 'number' ? widget.config.border_radius : ''}
              on:input={(e) => setRadius(Number(e.currentTarget.value))}
            />
            <span class="radius-val">{typeof widget.config.border_radius === 'number' ? `${widget.config.border_radius.toFixed(2)} rem` : 'default'}</span>
            {#if typeof widget.config.border_radius === 'number'}
              <button type="button" class="ghost sm" on:click={clearRadius}>Reset</button>
            {/if}
          </div>
        </Field>
      </Section>

      <Section label="Placement">
        <div class="pos-grid">
          <label class="pos-cell">
            <span>Col</span>
            <input type="number" min="1" max={layout.cols} value={widget.position.col} on:input={(e) => setPos('col', Number(e.currentTarget.value))} />
          </label>
          <label class="pos-cell">
            <span>Row</span>
            <input type="number" min="1" max={layout.rows} value={widget.position.row} on:input={(e) => setPos('row', Number(e.currentTarget.value))} />
          </label>
          <label class="pos-cell">
            <span>Width</span>
            <input type="number" min="1" max={layout.cols} value={widget.position.w} on:input={(e) => setPos('w', Number(e.currentTarget.value))} />
          </label>
          <label class="pos-cell">
            <span>Height</span>
            <input type="number" min="1" max={layout.rows} value={widget.position.h} on:input={(e) => setPos('h', Number(e.currentTarget.value))} />
          </label>
        </div>
        <span class="hint-line">Or drag the tile on the canvas — arrow keys nudge, Shift+arrow resizes.</span>
      </Section>
    </div>
  </div>
{/if}

<style>
  /* Empty state */
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.85rem;
    padding: 2.5rem 1.25rem;
    color: var(--c-fg-3);
    min-height: 12rem;
  }
  .empty-mark {
    width: 3rem;
    height: 3rem;
    display: grid;
    place-items: center;
    border-radius: var(--radius-md);
    background: var(--c-surface-2);
    border: 1px solid var(--c-line);
    color: var(--c-fg-3);
  }
  .empty p {
    font-size: 0.88rem;
    max-width: 16rem;
    line-height: 1.5;
    color: var(--c-fg-3);
  }

  .inspector {
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .ic {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    color: var(--ic-accent, var(--c-fg-2));
    background: color-mix(in srgb, var(--ic-accent, #888888) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--ic-accent, #888888) 32%, transparent);
  }
  .name-in {
    flex: 1;
    min-width: 0;
    min-height: 2.25rem;
    font-size: 0.95rem;
    font-weight: 500;
    padding: 0 0.6rem;
  }
  .head .tag { flex-shrink: 0; }
  .head-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .head-actions button {
    flex: 1;
  }
  button.sm {
    min-height: 2.1rem;
    padding: 0 0.7rem;
    font-size: 0.8rem;
    gap: 0.35rem;
  }
  button.danger.armed {
    background: var(--c-danger);
    color: var(--c-bg);
  }

  .body {
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--c-line);
  }
  /* Per-kind component renders its own .w-section blocks; give the block a
     divider so it reads as a peer of the inspector-owned sections. */
  .kind-fields {
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--c-line);
  }

  .radius-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .radius-row input[type='range'] { flex: 1; min-width: 5rem; }
  .radius-val {
    font-family: var(--f-mono);
    font-size: 0.78rem;
    color: var(--c-fg-3);
    min-width: 4.5rem;
    text-align: right;
  }

  .pos-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.6rem;
  }
  .pos-cell {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.78rem;
    color: var(--c-fg-2);
  }
  .pos-cell input {
    max-width: none;
    width: 100%;
    font-family: var(--f-mono);
  }
  .hint-line {
    font-size: 0.78rem;
    color: var(--c-fg-3);
  }
</style>
