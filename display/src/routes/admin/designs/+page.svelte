<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/admin/api';

  type Pack = Awaited<ReturnType<typeof api.designs.list>>[number];

  let packs: Pack[] = [];
  let loading = true;
  let error: string | null = null;
  let query = '';
  let busy = false;

  $: filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return packs;
    return packs.filter((p) => p.name.toLowerCase().includes(q) || p.slug.includes(q));
  })();

  $: userPacks = filtered.filter((p) => p.source === 'user');
  $: builtinPacks = filtered.filter((p) => p.source === 'builtin');
  $: hasAnyUserPacks = packs.some((p) => p.source === 'user');

  async function refresh() {
    loading = true;
    error = null;
    try {
      packs = await api.designs.list();
    } catch (err) {
      error = err instanceof Error ? err.message : 'failed to load designs';
    } finally {
      loading = false;
    }
  }

  function createNew() {
    if (busy) return;
    busy = true;
    goto('/admin/designs/new');
  }

  async function remove(slug: string, name: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm(`Delete design system "${name}"?\n\nThis cannot be undone.`)) return;
    try {
      await api.designs.remove(slug);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'failed to delete');
    }
  }

  // First color tends to be the background; fall back to a deep neutral if the
  // pack omits one so the specimen card still renders.
  function bgOf(p: Pack): string {
    return p.preview.colors[0] ?? '#111';
  }
  function fgOf(p: Pack): string {
    // Highest-contrast remaining color (usually `text` in the pack frontmatter).
    return p.preview.colors[p.preview.colors.length - 1] ?? '#fff';
  }
  function accentOf(p: Pack): string {
    return p.preview.colors[2] ?? p.preview.colors[1] ?? fgOf(p);
  }
  function fontStack(p: Pack): string {
    const f = p.preview.font_family;
    return f ? `'${f}', Georgia, ui-serif, serif` : `Georgia, ui-serif, serif`;
  }

  onMount(refresh);
</script>

<svelte:head><title>Designs · Cosmos</title></svelte:head>

<header class="page-header reveal reveal-1">
  <div class="head-text">
    <span class="eyebrow">Design systems</span>
    <h1>Designs</h1>
    <p class="lede">
      Typographic and chromatic packs that shape how the agent composes scenes. Built-ins ship with
      Cosmos; your packs live alongside them and can be edited anytime.
    </p>
  </div>
  <button class="primary" on:click={createNew} disabled={busy}>
    {busy ? 'Opening…' : '+ New design'}
  </button>
</header>

<div class="toolbar reveal reveal-2">
  <div class="search">
    <span class="icon" aria-hidden="true">⌕</span>
    <input
      type="search"
      placeholder="Search designs…"
      bind:value={query}
      aria-label="Search designs"
    />
  </div>
  {#if !loading && !error}
    <span class="count tag muted">{filtered.length} of {packs.length}</span>
  {/if}
</div>

{#if loading}
  <p class="loading">Loading designs…</p>
{:else if error}
  <p class="error">{error}</p>
{:else}
  {#if userPacks.length > 0}
    <section class="section reveal reveal-2">
      <div class="section-head">
        <span class="eyebrow">Yours</span>
        <span class="rule" aria-hidden="true"></span>
        <span class="count-inline mono">{userPacks.length}</span>
      </div>
      <ul class="grid">
        {#each userPacks as p (p.slug)}
          <li>
            <a
              class="card-link"
              href={`/admin/designs/${p.slug}`}
              aria-label={`Edit ${p.name}`}
            >
              <article
                class="specimen"
                style="--pk-bg: {bgOf(p)}; --pk-fg: {fgOf(p)}; --pk-accent: {accentOf(p)}; --pk-font: {fontStack(p)};"
              >
                <div class="spec-stage" aria-hidden="true">
                  <span class="spec-mark"></span>
                  <span class="spec-display">Aa</span>
                  <span class="spec-strip">
                    {#each p.preview.colors.slice(0, 4) as c}
                      <span class="spec-swatch" style="background: {c}"></span>
                    {/each}
                  </span>
                </div>
                <footer class="spec-meta">
                  <div class="meta-line">
                    <h3 class="pack-name">{p.name}</h3>
                    <span class="tag muted">user</span>
                  </div>
                  <div class="meta-line sub">
                    <span class="slug mono">{p.slug}</span>
                    {#if p.preview.font_family}
                      <span class="font-chip" style="font-family: {fontStack(p)};">{p.preview.font_family}</span>
                    {/if}
                  </div>
                </footer>
              </article>
            </a>
            <button
              class="ghost danger icon delete-overlay"
              aria-label={`Delete ${p.name}`}
              title="Delete"
              on:click={(e) => remove(p.slug, p.name, e)}
            >×</button>
          </li>
        {/each}
      </ul>
    </section>
  {:else if !query}
    <section class="empty-state reveal reveal-2">
      <span class="eyebrow">Yours</span>
      <h2>No design systems yet</h2>
      <p>
        Start from a fresh template, or open a built-in below and duplicate it as your own.
      </p>
      <button class="primary" on:click={createNew} disabled={busy}>
        {busy ? 'Opening…' : 'Create your first design'}
      </button>
    </section>
  {/if}

  {#if builtinPacks.length > 0}
    <section class="section reveal reveal-3">
      <div class="section-head">
        <span class="eyebrow">Built-in</span>
        <span class="rule" aria-hidden="true"></span>
        <span class="count-inline mono">{builtinPacks.length}</span>
      </div>
      <ul class="grid">
        {#each builtinPacks as p (p.slug)}
          <li>
            <a
              class="card-link"
              href={`/admin/designs/${p.slug}`}
              aria-label={`View ${p.name}`}
            >
              <article
                class="specimen"
                style="--pk-bg: {bgOf(p)}; --pk-fg: {fgOf(p)}; --pk-accent: {accentOf(p)}; --pk-font: {fontStack(p)};"
              >
                <div class="spec-stage" aria-hidden="true">
                  <span class="spec-mark"></span>
                  <span class="spec-display">Aa</span>
                  <span class="spec-strip">
                    {#each p.preview.colors.slice(0, 4) as c}
                      <span class="spec-swatch" style="background: {c}"></span>
                    {/each}
                  </span>
                </div>
                <footer class="spec-meta">
                  <div class="meta-line">
                    <h3 class="pack-name">{p.name}</h3>
                    <span class="tag accent">built-in</span>
                  </div>
                  <div class="meta-line sub">
                    <span class="slug mono">{p.slug}</span>
                    {#if p.preview.font_family}
                      <span class="font-chip" style="font-family: {fontStack(p)};">{p.preview.font_family}</span>
                    {/if}
                  </div>
                </footer>
              </article>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if !loading && filtered.length === 0 && query}
    <p class="empty">No designs match "{query}".</p>
  {/if}

  {#if !hasAnyUserPacks && builtinPacks.length > 0 && !query}
    <p class="hint-line reveal reveal-4">
      Tip: open a built-in and use <em>Duplicate as user pack</em> to fork it.
    </p>
  {/if}
{/if}

<style>
  .page-header {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    margin-bottom: 1.75rem;
  }
  .page-header h1 {
    font-size: clamp(1.75rem, 4.5vw, 2.5rem);
    margin-top: 0.35rem;
  }
  .lede {
    margin-top: 0.55rem;
    max-width: 38rem;
    color: var(--c-fg-2);
    font-size: 0.95rem;
    line-height: 1.55;
  }
  .page-header .primary { justify-self: start; }
  @media (min-width: 720px) {
    .page-header {
      grid-template-columns: 1fr auto;
      align-items: end;
    }
    .page-header .primary { justify-self: end; }
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .search { flex: 1; position: relative; }
  .search input { padding-left: 2.5rem; }
  .search .icon {
    position: absolute;
    left: 0.85rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--c-fg-3);
    font-size: 1rem;
    pointer-events: none;
  }
  .count { flex-shrink: 0; }

  .section { margin-top: 2.25rem; }
  .section:first-of-type { margin-top: 0; }
  .section-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .section-head .rule {
    flex: 1;
    height: 1px;
    background: var(--c-line);
  }
  .count-inline {
    font-size: 0.72rem;
    color: var(--c-fg-3);
    letter-spacing: 0.04em;
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  @media (min-width: 600px) { .grid { grid-template-columns: repeat(2, 1fr); gap: 1.1rem; } }
  @media (min-width: 900px) { .grid { grid-template-columns: repeat(3, 1fr); } }

  .grid li {
    position: relative;
  }

  .card-link {
    display: block;
    text-decoration: none;
    color: inherit;
    border-radius: var(--radius-md);
    transition: transform 220ms var(--ease);
  }
  .card-link:hover { color: inherit; transform: translateY(-2px); }
  .card-link:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--c-accent-tint);
  }

  /* Specimen card — each pack rendered as a typographic poster in its own palette.
     The point: glance at the gallery and immediately recognize the mood of each pack. */
  .specimen {
    display: flex;
    flex-direction: column;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    overflow: hidden;
    transition: border-color 200ms var(--ease), background 200ms var(--ease);
  }
  .card-link:hover .specimen {
    border-color: var(--c-line-strong);
    background: var(--c-surface-hover);
  }

  .spec-stage {
    position: relative;
    aspect-ratio: 4 / 3;
    background: var(--pk-bg);
    color: var(--pk-fg);
    overflow: hidden;
    display: grid;
    place-items: center;
    /* Subtle vignette so the specimen reads as lit, not flat. */
    box-shadow: inset 0 -40% 80px -40px rgba(0, 0, 0, 0.35);
  }

  .spec-mark {
    /* Small accent dot in the top-left, like a designer's chop. */
    position: absolute;
    top: 0.85rem;
    left: 0.85rem;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 999px;
    background: var(--pk-accent);
    box-shadow: 0 0 16px var(--pk-accent);
    opacity: 0.85;
  }

  .spec-display {
    font-family: var(--pk-font);
    font-size: clamp(5rem, 14vw, 7.5rem);
    font-weight: 500;
    letter-spacing: -0.04em;
    line-height: 0.85;
    color: var(--pk-fg);
    /* Allow the descender of the 'a' to bleed a touch toward the strip below. */
    transform: translateY(0.25rem);
    transition: transform 360ms var(--ease);
  }
  .card-link:hover .spec-display { transform: translateY(0) scale(1.02); }

  .spec-strip {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    height: 0.45rem;
  }
  .spec-swatch {
    flex: 1;
    height: 100%;
  }

  .spec-meta {
    padding: 0.85rem 1rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border-top: 1px solid var(--c-line);
  }
  .meta-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-width: 0;
  }
  .meta-line.sub { color: var(--c-fg-3); font-size: 0.78rem; }
  .pack-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--c-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .slug {
    font-size: 0.72rem;
    color: var(--c-fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .font-chip {
    font-size: 0.85rem;
    color: var(--c-fg-2);
    padding: 0.1rem 0.5rem;
    background: var(--c-surface-2);
    border-radius: 999px;
    border: 1px solid var(--c-line);
    white-space: nowrap;
    flex-shrink: 0;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .delete-overlay {
    position: absolute;
    top: 0.55rem;
    right: 0.55rem;
    width: 2rem;
    height: 2rem;
    min-height: 2rem;
    font-size: 1.1rem;
    line-height: 1;
    opacity: 0;
    transition: opacity 180ms var(--ease), background 150ms var(--ease);
    background: rgba(8, 9, 15, 0.65);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .grid li:hover .delete-overlay,
  .grid li:focus-within .delete-overlay {
    opacity: 1;
  }
  /* Touch — always visible since there's no hover. */
  @media (hover: none) {
    .delete-overlay { opacity: 1; }
  }

  .empty-state {
    background: var(--c-surface);
    border: 1px dashed var(--c-line-strong);
    border-radius: var(--radius-md);
    padding: 2.5rem 1.5rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    align-items: center;
  }
  .empty-state .eyebrow { margin-bottom: 0.25rem; }
  .empty-state p { max-width: 32rem; color: var(--c-fg-2); }

  .loading, .empty { color: var(--c-fg-3); padding: 1rem 0; }
  .error { color: var(--c-danger); padding: 1rem 0; }

  .hint-line {
    margin-top: 1.5rem;
    text-align: center;
    color: var(--c-fg-3);
    font-size: 0.85rem;
  }
  .hint-line em {
    color: var(--c-fg-2);
    font-style: normal;
    border-bottom: 1px dotted var(--c-line-strong);
  }
</style>
