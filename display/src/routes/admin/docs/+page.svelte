<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { marked } from 'marked';
  import { api } from '$lib/admin/api';

  type Doc = { slug: string; title: string };

  let docs: Doc[] = [];
  let activeSlug: string | null = null;
  let activeMarkdown = '';
  let activeHtml = '';
  let loading = true;
  let copyState: 'idle' | 'copied' | 'error' = 'idle';
  let proseEl: HTMLDivElement | null = null;
  let query = '';
  let matchCount = 0;
  let totalSections = 0;

  /** Section index: each entry is one block of DOM elements bounded by an h2
   *  (or h3 — whichever heading level dominates the doc), plus the lower-cased
   *  text of the entire block for fast filtering. Rebuilt every time a doc
   *  loads. */
  type Section = { elements: HTMLElement[]; text: string };
  let sections: Section[] = [];

  // Configure marked once: GFM-flavored, line-break preserved (so the
  // pasted-in tables and lists in the agent contracts render correctly).
  marked.setOptions({ gfm: true, breaks: false });

  function isAgentDoc(slug: string): boolean {
    return slug.endsWith('-agent') || slug.includes('agent');
  }

  async function loadDoc(slug: string) {
    activeSlug = slug;
    activeMarkdown = '';
    activeHtml = '';
    query = '';
    sections = [];
    matchCount = 0;
    totalSections = 0;
    const md = await api.docs.get(slug);
    if (md === null) {
      activeMarkdown = '';
      activeHtml = '<p class="error">Failed to load this doc.</p>';
      return;
    }
    activeMarkdown = md;
    activeHtml = await marked.parse(md);
    // Scroll the content pane to top after swap
    await tick();
    contentEl?.scrollTo({ top: 0, behavior: 'smooth' });
    indexSections();
  }

  /** Group rendered elements by heading level. Some docs (entity reference)
   *  use h3 as the unit; others (the contracts) use h2. Pick the heaviest tag
   *  in the doc as the section delimiter. h1 is always treated as the doc
   *  title and never grouped. */
  function indexSections() {
    if (!proseEl) return;
    const children = Array.from(proseEl.children) as HTMLElement[];
    const h3Count = children.filter((c) => c.tagName === 'H3').length;
    const h2Count = children.filter((c) => c.tagName === 'H2').length;
    // h3 wins when there are noticeably more of them — e.g. the entity ref
    // has a single h2 ("HA entity reference") and ~14 h3s under it. h2 wins
    // for the contract docs (Contract / What's available / What's forbidden).
    const delim = h3Count >= Math.max(3, h2Count + 2) ? 'H3' : 'H2';

    sections = [];
    let current: Section | null = null;
    for (const el of children) {
      if (el.tagName === 'H1') continue; // never grouped
      if (el.tagName === delim || (delim === 'H3' && el.tagName === 'H2')) {
        // New section starts. h2s in an h3-delimited doc still seed sections
        // so a search like "entity reference" matches the parent heading.
        if (current) sections.push(current);
        current = { elements: [el], text: (el.textContent || '').toLowerCase() };
      } else if (current) {
        current.elements.push(el);
        current.text += ' ' + (el.textContent || '').toLowerCase();
      } else {
        // Pre-first-heading prose — treat as its own section so it isn't
        // permanently hidden when a query is active.
        current = { elements: [el], text: (el.textContent || '').toLowerCase() };
      }
    }
    if (current) sections.push(current);
    totalSections = sections.length;
    matchCount = totalSections;
    // Initial pass clears any leftover hide state from a prior doc.
    applyFilter();
  }

  /** Show every section whose combined text contains the query (case-
   *  insensitive). Empty query restores everything. */
  function applyFilter() {
    if (!proseEl) return;
    const q = query.trim().toLowerCase();
    if (q === '') {
      for (const s of sections) for (const el of s.elements) el.style.display = '';
      matchCount = totalSections;
      return;
    }
    let n = 0;
    for (const s of sections) {
      const hit = s.text.includes(q);
      if (hit) n++;
      for (const el of s.elements) el.style.display = hit ? '' : 'none';
    }
    matchCount = n;
  }

  $: if (proseEl) { void query; applyFilter(); }

  /** Copy text to clipboard with a robust fallback. The async Clipboard API
   *  requires a secure context (HTTPS or localhost). Cosmos in HA Ingress
   *  serves over plain HTTP on the LAN, so navigator.clipboard is often
   *  undefined or rejects with a SecurityError. The legacy execCommand path
   *  works in any context but requires the source element to be in the DOM
   *  and selected synchronously inside a user-gesture handler. */
  function copyText(text: string): boolean {
    // Try the modern API first — when it works, it's the cleanest path.
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => {
        // Async failure: fall through to the legacy path below by re-running.
        legacyCopy(text);
      });
      return true;
    }
    return legacyCopy(text);
  }

  function legacyCopy(text: string): boolean {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      // Visible-but-off-screen so iOS/Android still register the selection.
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.opacity = '0';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) {
      console.error('legacy clipboard copy failed', err);
      return false;
    }
  }

  function copyMarkdown() {
    if (!activeMarkdown) return;
    const ok = copyText(activeMarkdown);
    copyState = ok ? 'copied' : 'error';
    setTimeout(() => { copyState = 'idle'; }, 1800);
  }

  let contentEl: HTMLDivElement;

  onMount(async () => {
    docs = await api.docs.list();
    loading = false;
    if (docs.length > 0) {
      // Default to the first doc — agent contracts come first by server sort.
      await loadDoc(docs[0].slug);
    }
  });
</script>

<header class="hero reveal reveal-1">
  <h1>Docs</h1>
</header>

{#if loading}
  <p class="loading">Loading docs…</p>
{:else if docs.length === 0}
  <section class="empty-card reveal reveal-2">
    <h2>No docs available</h2>
    <p>The server couldn't find a bundled <span class="mono">docs/</span> directory.</p>
  </section>
{:else}
  <div class="docs-shell reveal reveal-2">
    <aside class="sidebar" aria-label="Docs">
      <ul>
        {#each docs as d (d.slug)}
          <li>
            <button
              type="button"
              class="doc-link"
              class:active={d.slug === activeSlug}
              on:click={() => loadDoc(d.slug)}
            >
              <span class="doc-title">{d.title}</span>
              {#if isAgentDoc(d.slug)}
                <span class="tag cool">agent</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </aside>

    <article class="content card" bind:this={contentEl}>
      {#if activeSlug}
        <div class="content-toolbar">
          <span class="slug mono">{activeSlug}.md</span>
          <div class="toolbar-actions">
            <div class="search">
              <span class="search-icon" aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="Filter sections…"
                bind:value={query}
                aria-label="Filter doc sections"
              />
              {#if query}
                <span class="search-count" aria-live="polite">{matchCount}/{totalSections}</span>
                <button type="button" class="search-clear" aria-label="Clear filter" on:click={() => (query = '')}>×</button>
              {/if}
            </div>
            <button
              type="button"
              class="copy"
              class:copied={copyState === 'copied'}
              class:error={copyState === 'error'}
              on:click={copyMarkdown}
              disabled={!activeMarkdown}
            >
              {#if copyState === 'copied'}✓ Copied
              {:else if copyState === 'error'}✗ Copy failed
              {:else}Copy markdown
              {/if}
            </button>
          </div>
        </div>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="prose" bind:this={proseEl}>{@html activeHtml}</div>
        {#if query && matchCount === 0}
          <p class="no-matches">No sections match "{query}".</p>
        {/if}
      {/if}
    </article>
  </div>
{/if}

<style>
  .hero {
    margin-bottom: 1.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 42rem;
  }
  .hero h1 {
    font-size: clamp(1.6rem, 4vw, 2.25rem);
    line-height: 1.15;
  }
  .hero p { font-size: 1rem; }
  .loading { color: var(--c-fg-3); }

  .empty-card {
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    padding: 2.5rem 1.5rem;
    text-align: center;
  }
  .empty-card h2 { margin-bottom: 0.5rem; }
  .empty-card p { color: var(--c-fg-2); }

  /* Stack on mobile, sidebar+content on desktop. The sidebar collapses to a
     scrolling row of pills on mobile so it doesn't burn vertical space. */
  .docs-shell {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }

  .sidebar ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: row;
    gap: 0.5rem;
    overflow-x: auto;
    scrollbar-width: thin;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 0.25rem; /* room for scrollbar */
  }
  .sidebar li { flex: 0 0 auto; }
  .doc-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.85rem;
    min-height: 0;
    height: auto;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: 999px;
    color: var(--c-fg-2);
    cursor: pointer;
    font-size: 0.88rem;
    font-weight: 500;
    text-align: left;
    transition: background 150ms var(--ease), color 150ms var(--ease), border-color 150ms var(--ease);
    white-space: nowrap;
  }
  .doc-link:hover {
    background: var(--c-surface-hover);
    color: var(--c-fg);
    border-color: var(--c-line-strong);
  }
  .doc-link.active {
    background: var(--c-accent-tint);
    color: var(--c-accent);
    border-color: rgba(255, 209, 122, 0.45);
  }
  .doc-title { overflow: hidden; text-overflow: ellipsis; }

  .content {
    padding: 1.5rem clamp(1rem, 3vw, 1.75rem);
    /* Cap content width so paragraphs stay readable even on a 32" monitor. */
    max-width: 60rem;
  }
  .content-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding-bottom: 1rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--c-line);
  }
  .slug { color: var(--c-fg-3); font-size: 0.82rem; flex-shrink: 0; }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  /* Compact search input that lives inside the toolbar — visually distinct
     from the surrounding card so it reads as an action, not body content. */
  .search {
    position: relative;
    display: inline-flex;
    align-items: center;
    background: var(--c-surface-2);
    border: 1px solid var(--c-line);
    border-radius: 999px;
    padding: 0 0.6rem 0 0.65rem;
    transition: border-color 150ms var(--ease), box-shadow 150ms var(--ease);
    height: 2.1rem;
  }
  .search:focus-within {
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-tint);
  }
  .search-icon {
    color: var(--c-fg-3);
    font-size: 0.95rem;
    line-height: 1;
    padding-right: 0.4rem;
  }
  .search input {
    /* Override the global input chrome — this is a toolbar control, not
       a form field. */
    background: transparent !important;
    border: 0 !important;
    border-radius: 0 !important;
    padding: 0 !important;
    min-height: 0 !important;
    height: 100%;
    width: 12rem;
    font-size: 0.85rem;
    color: var(--c-fg);
    outline: none !important;
    box-shadow: none !important;
  }
  .search input::placeholder { color: var(--c-fg-3); }
  .search-count {
    font-family: var(--f-mono);
    font-size: 0.72rem;
    color: var(--c-fg-3);
    padding: 0 0.45rem 0 0.25rem;
    flex-shrink: 0;
  }
  .search-clear {
    width: 1.4rem;
    height: 1.4rem;
    min-height: 0;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 999px;
    color: var(--c-fg-3);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }
  .search-clear:hover { color: var(--c-fg); }

  .copy {
    min-height: 0;
    height: 2.1rem;
    padding: 0 0.85rem;
    font-size: 0.82rem;
  }
  .copy.copied { color: var(--c-success); border-color: rgba(109, 213, 140, 0.45); }
  .copy.error { color: var(--c-danger); border-color: rgba(240, 107, 117, 0.45); }

  .no-matches {
    color: var(--c-fg-3);
    font-size: 0.9rem;
    padding: 1rem 0;
    text-align: center;
  }

  /* Prose: tuned for technical docs. Generous line-height, JetBrains Mono
     for code, accent-tinted links, hairline tables, and a cool gutter
     stripe on blockquotes that picks up the favicon arc color. */
  .prose {
    color: var(--c-fg);
    line-height: 1.65;
    font-size: 0.94rem;
  }
  .prose :global(h1) { font-size: 1.5rem; margin: 0 0 0.75rem; letter-spacing: -0.01em; }
  .prose :global(h2) { font-size: 1.2rem; margin: 1.75rem 0 0.6rem; letter-spacing: -0.005em; }
  .prose :global(h3) { font-size: 1.02rem; margin: 1.4rem 0 0.5rem; color: var(--c-fg); }
  .prose :global(h4) { font-size: 0.95rem; margin: 1.2rem 0 0.4rem; color: var(--c-fg-2); }
  .prose :global(p)  { margin: 0 0 0.85rem; color: var(--c-fg); }
  .prose :global(a)  { color: var(--c-accent); text-decoration: underline; text-underline-offset: 2px; }
  .prose :global(a:hover) { color: var(--c-accent-hot); }
  .prose :global(ul),
  .prose :global(ol) { margin: 0 0 1rem; padding-left: 1.4rem; }
  .prose :global(li) { margin: 0.25rem 0; }
  .prose :global(code) {
    font-family: var(--f-mono);
    font-size: 0.86em;
    background: var(--c-surface-2);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    border: 1px solid var(--c-line);
  }
  .prose :global(pre) {
    background: #06080f;
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0.85rem 1rem;
    overflow-x: auto;
    margin: 0 0 1rem;
    font-size: 0.85rem;
  }
  .prose :global(pre code) {
    background: transparent;
    padding: 0;
    border: 0;
    font-size: inherit;
  }
  .prose :global(blockquote) {
    margin: 0 0 1rem;
    padding: 0.5rem 0 0.5rem 1rem;
    border-left: 3px solid var(--c-cool);
    color: var(--c-fg-2);
    background: var(--c-cool-tint);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }
  .prose :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 1rem;
    font-size: 0.88rem;
  }
  .prose :global(th),
  .prose :global(td) {
    text-align: left;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--c-line);
    vertical-align: top;
  }
  .prose :global(th) {
    color: var(--c-fg-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.75rem;
    font-weight: 500;
  }
  .prose :global(hr) {
    border: 0;
    border-top: 1px solid var(--c-line);
    margin: 1.5rem 0;
  }
  .prose :global(.error) { color: var(--c-danger); }

  @media (min-width: 800px) {
    .docs-shell {
      grid-template-columns: 14rem 1fr;
      gap: 1.5rem;
      align-items: start;
    }
    .sidebar {
      position: sticky;
      top: 5rem;
    }
    .sidebar ul {
      flex-direction: column;
      overflow-x: visible;
      padding-bottom: 0;
    }
    .doc-link {
      width: 100%;
      justify-content: space-between;
    }
  }
</style>
