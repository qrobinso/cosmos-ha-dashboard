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
  let copyState: 'idle' | 'copied' = 'idle';

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
  }

  async function copyMarkdown() {
    if (!activeMarkdown) return;
    try {
      await navigator.clipboard.writeText(activeMarkdown);
      copyState = 'copied';
      setTimeout(() => { copyState = 'idle'; }, 1600);
    } catch (err) {
      console.error('clipboard write failed', err);
    }
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
  <span class="eyebrow">Docs</span>
  <h1>Reference for users — and for agents.</h1>
  <p>Everything bundled with Cosmos: scene authoring contracts, the canvas widget API, and the agent-facing system-prompt material. Tap "Copy markdown" to paste a doc straight into an LLM tool.</p>
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
          <button type="button" class="copy" on:click={copyMarkdown} disabled={!activeMarkdown}>
            {copyState === 'copied' ? '✓ Copied' : 'Copy markdown'}
          </button>
        </div>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="prose">{@html activeHtml}</div>
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
    gap: 1rem;
    padding-bottom: 1rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--c-line);
  }
  .slug { color: var(--c-fg-3); font-size: 0.82rem; }
  .copy {
    min-height: 0;
    height: auto;
    padding: 0.45rem 0.85rem;
    font-size: 0.82rem;
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
