<script lang="ts">
  // Combobox-style entity picker modeled on Home Assistant's entity selector:
  // free-text search across entity_id + friendly_name, keyboard navigable,
  // clears with Escape or the × button. Caller filters the list to its
  // relevant domain(s); this component only handles search + selection.
  import { createEventDispatcher } from 'svelte';

  type Entity = { entity_id: string; state?: string; attributes?: Record<string, unknown> };

  const dispatch = createEventDispatcher<{ change: string }>();

  export let value = '';
  export let entities: Entity[] = [];
  export let placeholder = 'Search entities…';
  /** Optional explicit fallback when the bound value isn't in `entities` (e.g. an
   * entity from a freshly-disconnected HA install). Defaults to showing the id. */
  export let allowCustom = true;

  let query = '';
  let open = false;
  let activeIdx = 0;
  let inputEl: HTMLInputElement;
  let listEl: HTMLDivElement;
  let blurTimer: ReturnType<typeof setTimeout> | null = null;

  function friendly(e: Entity): string {
    const fn = e.attributes?.friendly_name;
    return typeof fn === 'string' ? fn : '';
  }

  $: filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) => {
      if (e.entity_id.toLowerCase().includes(q)) return true;
      const fn = friendly(e).toLowerCase();
      return fn.includes(q);
    });
  })();

  $: if (activeIdx >= filtered.length) activeIdx = Math.max(0, filtered.length - 1);

  $: selectedEntity = entities.find((e) => e.entity_id === value);

  function select(id: string) {
    value = id;
    query = '';
    open = false;
    inputEl?.blur();
    dispatch('change', id);
  }

  function onInput(e: Event) {
    query = (e.currentTarget as HTMLInputElement).value;
    open = true;
    activeIdx = 0;
  }

  function onFocus() {
    if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
    query = '';
    activeIdx = Math.max(0, filtered.findIndex((e) => e.entity_id === value));
    open = true;
  }

  function onBlur() {
    // Defer close so option mousedown can fire first.
    blurTimer = setTimeout(() => { open = false; query = ''; }, 120);
  }

  function ensureVisible() {
    requestAnimationFrame(() => {
      const el = listEl?.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open = true;
      activeIdx = Math.min(activeIdx + 1, Math.max(0, filtered.length - 1));
      ensureVisible();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      ensureVisible();
    } else if (e.key === 'Enter') {
      if (open && filtered[activeIdx]) {
        e.preventDefault();
        select(filtered[activeIdx].entity_id);
      } else if (allowCustom && query) {
        e.preventDefault();
        select(query.trim());
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      query = '';
      open = false;
      inputEl?.blur();
    } else if (e.key === 'Backspace' && !query && value) {
      // Quick-clear: Backspace on an empty input clears the selection.
      value = '';
      dispatch('change', '');
    }
  }

  function clear() {
    value = '';
    query = '';
    open = true;
    inputEl?.focus();
    dispatch('change', '');
  }

  // Display value: while focused/open we show the search query; otherwise the
  // selected entity_id (or its friendly name if available).
  $: displayValue = open
    ? query
    : (selectedEntity ? selectedEntity.entity_id : value);
</script>

<div class="ent-picker" class:open>
  <div class="trigger" class:has-value={!!value}>
    <input
      bind:this={inputEl}
      class="trigger-input"
      type="text"
      role="combobox"
      aria-expanded={open}
      aria-autocomplete="list"
      {placeholder}
      value={displayValue}
      on:input={onInput}
      on:focus={onFocus}
      on:blur={onBlur}
      on:keydown={onKeyDown}
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
    />
    {#if value && !open}
      <button type="button" class="clear" on:mousedown|preventDefault={clear} aria-label="Clear selection">×</button>
    {/if}
    <span class="caret" aria-hidden="true">▾</span>
  </div>
  {#if open}
    <div class="list" bind:this={listEl} role="listbox">
      {#if entities.length === 0}
        <div class="empty">No entities cached. Set HA_URL/HA_TOKEN to load real entities.</div>
      {:else if filtered.length === 0}
        <div class="empty">No matches for "{query}"</div>
      {:else}
        {#each filtered as e, i (e.entity_id)}
          {@const fn = friendly(e)}
          <button
            type="button"
            class="opt"
            class:active={i === activeIdx}
            class:selected={e.entity_id === value}
            data-idx={i}
            role="option"
            aria-selected={e.entity_id === value}
            on:mousedown|preventDefault={() => select(e.entity_id)}
            on:mouseenter={() => (activeIdx = i)}
          >
            <span class="opt-id">{e.entity_id}</span>
            {#if fn && fn !== e.entity_id}<span class="opt-friendly">{fn}</span>{/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .ent-picker {
    position: relative;
    width: 100%;
  }
  .trigger {
    position: relative;
    display: flex;
    align-items: center;
  }
  .trigger-input {
    width: 100%;
    padding-right: 3.25rem; /* room for clear + caret */
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.95rem;
  }
  .clear,
  .caret {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--c-fg-3);
    pointer-events: none;
  }
  .caret {
    right: 0.85rem;
    font-size: 0.75rem;
    transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .ent-picker.open .caret {
    transform: translateY(-50%) rotate(180deg);
  }
  .clear {
    right: 2rem;
    width: 1.5rem;
    height: 1.5rem;
    display: grid;
    place-items: center;
    border-radius: 999px;
    pointer-events: auto;
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    color: var(--c-fg-2);
  }
  .clear:hover {
    background: var(--c-surface-hover);
    color: var(--c-fg);
  }
  .list {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    right: 0;
    z-index: 30;
    max-height: 18rem;
    overflow-y: auto;
    background: var(--c-surface-2, #1a1a1a);
    border: 1px solid var(--c-line-strong, rgba(255, 255, 255, 0.12));
    border-radius: 0.5rem;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
    padding: 0.25rem;
    /* Native momentum scrolling on the touch tablet */
    -webkit-overflow-scrolling: touch;
  }
  .empty {
    padding: 0.85rem 0.75rem;
    color: var(--c-fg-3);
    font-size: 0.85rem;
    text-align: center;
  }
  .opt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    width: 100%;
    padding: 0.55rem 0.75rem;
    background: transparent;
    border: none;
    border-radius: 0.35rem;
    text-align: left;
    cursor: pointer;
    color: var(--c-fg);
    min-height: var(--tap, 44px);
  }
  .opt.active {
    background: var(--c-surface-hover, rgba(255, 255, 255, 0.06));
  }
  .opt.selected {
    color: var(--c-accent, #f0c14b);
  }
  .opt-id {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.85rem;
  }
  .opt-friendly {
    font-size: 0.78rem;
    color: var(--c-fg-3);
  }
</style>
