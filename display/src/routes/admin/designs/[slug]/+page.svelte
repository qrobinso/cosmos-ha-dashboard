<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/admin/api';

  type Detail = Awaited<ReturnType<typeof api.designs.get>>;

  $: slug = $page.params.slug;

  let pack: Detail | null = null;
  let loading = true;
  let loadError: string | null = null;

  // Editor state
  let nameDraft = '';
  let contentDraft = '';
  let originalName = '';
  let originalContent = '';
  let saving = false;
  let saveError: string | null = null;
  let confirmDelete = false;
  let textareaEl: HTMLTextAreaElement;

  $: isBuiltin = pack?.source === 'builtin';
  $: dirty = pack !== null && (nameDraft !== originalName || contentDraft !== originalContent);
  $: parseErrors = pack?.parseErrors ?? [];

  async function load(target: string) {
    loading = true;
    loadError = null;
    try {
      pack = await api.designs.get(target);
      nameDraft = pack.name;
      contentDraft = pack.content;
      originalName = pack.name;
      originalContent = pack.content;
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'failed to load';
      pack = null;
    } finally {
      loading = false;
    }
  }

  $: if (slug) void load(slug);

  async function save() {
    if (!pack || isBuiltin || !dirty || saving) return;
    saving = true;
    saveError = null;
    try {
      const patch: { name?: string; content?: string } = {};
      if (nameDraft !== originalName) patch.name = nameDraft.trim();
      if (contentDraft !== originalContent) patch.content = contentDraft;
      await api.designs.update(pack.slug, patch);
      // Re-fetch so frontmatter / parse errors reflect the new state.
      await load(pack.slug);
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'failed to save';
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!pack || isBuiltin) return;
    if (!confirmDelete) {
      confirmDelete = true;
      // Auto-reset after a few seconds if user wanders off.
      setTimeout(() => (confirmDelete = false), 4000);
      return;
    }
    try {
      await api.designs.remove(pack.slug);
      // Avoid the unsaved-changes guard on the way out.
      originalName = nameDraft;
      originalContent = contentDraft;
      await goto('/admin/designs');
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'failed to delete';
    }
  }

  async function duplicate() {
    if (!pack) return;
    const suggested = `${pack.slug}-copy`;
    const proposed = (prompt('Slug for your copy:', suggested) ?? '').trim();
    if (!proposed) return;
    if (!/^[a-z0-9][a-z0-9-]+[a-z0-9]$/.test(proposed)) {
      alert('Slug must be lowercase, hyphen-separated, 3–64 chars (e.g. my-pack).');
      return;
    }
    try {
      const created = await api.designs.create({
        slug: proposed,
        name: `${pack.name} (copy)`,
        content: contentDraft,
      });
      await goto(`/admin/designs/${created.slug}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'failed to duplicate');
    }
  }

  // Tab inserts two spaces in the textarea (matching YAML/Markdown convention)
  // without trapping focus when the textarea is not focused.
  function onTextareaKey(e: KeyboardEvent) {
    if (e.key !== 'Tab' || isBuiltin) return;
    e.preventDefault();
    const ta = e.currentTarget as HTMLTextAreaElement;
    const { selectionStart: s, selectionEnd: en, value } = ta;
    if (e.shiftKey) {
      // Shift+Tab — strip up to two leading spaces from each affected line.
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const before = value.slice(0, lineStart);
      const middle = value.slice(lineStart, en).replace(/^ {1,2}/gm, '');
      const after = value.slice(en);
      contentDraft = before + middle + after;
      void tick().then(() => {
        ta.selectionStart = lineStart;
        ta.selectionEnd = before.length + middle.length;
      });
    } else {
      const next = value.slice(0, s) + '  ' + value.slice(en);
      contentDraft = next;
      void tick().then(() => {
        ta.selectionStart = ta.selectionEnd = s + 2;
      });
    }
  }

  // Cmd/Ctrl-S saves.
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  }

  function beforeUnload(e: BeforeUnloadEvent) {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', beforeUnload);
  });
  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', beforeUnload);
    }
  });

  // ---- Live preview derived from the draft content. ----
  // We re-parse the draft client-side (frontmatter + body split + a tiny YAML walk)
  // so the right pane updates as you type without round-tripping the server.

  function splitFrontmatter(src: string): { fm: string; body: string } {
    const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { fm: '', body: src };
    return { fm: m[1], body: m[2] };
  }

  type FmNode = Record<string, unknown>;

  /** Tiny indent-based YAML parser sufficient for our packs (scalars + 1-level
   *  nested maps + key:value pairs). Quoted strings are unwrapped. We don't
   *  attempt sequences — the live preview just falls back to "no preview" for
   *  malformed input, which is fine because the canonical parser runs server-side. */
  function parseFm(text: string): FmNode {
    const lines = text.split(/\r?\n/);
    const root: FmNode = {};
    const stack: { indent: number; node: FmNode }[] = [{ indent: -1, node: root }];
    for (const raw of lines) {
      if (!raw.trim() || raw.trim().startsWith('#')) continue;
      const indent = raw.length - raw.trimStart().length;
      const line = raw.trim();
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim();
      const rest = line.slice(colon + 1).trim();
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1].node;
      if (rest === '') {
        const child: FmNode = {};
        parent[key] = child;
        stack.push({ indent, node: child });
      } else {
        parent[key] = unquote(rest);
      }
    }
    return root;
  }

  function unquote(s: string): string {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  }

  $: split = splitFrontmatter(contentDraft);
  $: liveFm = (() => {
    try {
      return parseFm(split.fm);
    } catch {
      return {} as FmNode;
    }
  })();
  $: bodyDraft = split.body;

  function asStr(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
  }
  function asObj(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  }

  $: colorsObj = asObj(liveFm.colors) ?? {};
  $: colorEntries = Object.entries(colorsObj).filter(([, v]) => typeof v === 'string') as [string, string][];
  $: typography = asObj(liveFm.typography) ?? {};
  $: displayFont = asStr(asObj(typography.display)?.fontFamily);
  $: bodyFont = asStr(asObj(typography.body)?.fontFamily);
  $: spacingObj = asObj(liveFm.spacing) ?? {};
  $: spacingEntries = Object.entries(spacingObj).filter(([, v]) => typeof v === 'string') as [string, string][];

  function fontStack(family: string | null): string {
    return family ? `'${family}', Georgia, ui-serif, serif` : 'Georgia, serif';
  }

  function spacingToPx(v: string): number {
    const m = v.match(/^(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    return Math.min(96, parseFloat(m[1]));
  }

  // ---- Minimal markdown render: headings, lists, paragraphs, inline code/bold/italic.
  // Deliberately small — a true MD lib would be overkill for an admin preview.

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function inline(s: string): string {
    return escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }
  function renderMarkdown(src: string): string {
    const lines = src.split(/\r?\n/);
    const out: string[] = [];
    let inList = false;
    let para: string[] = [];
    const flushPara = () => {
      if (para.length === 0) return;
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    };
    const closeList = () => {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) {
        flushPara();
        closeList();
        continue;
      }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara();
        closeList();
        const level = h[1].length;
        out.push(`<h${level}>${inline(h[2])}</h${level}>`);
        continue;
      }
      const li = line.match(/^[-*]\s+(.*)$/);
      if (li) {
        flushPara();
        if (!inList) {
          out.push('<ul>');
          inList = true;
        }
        out.push(`<li>${inline(li[1])}</li>`);
        continue;
      }
      para.push(line.trim());
    }
    flushPara();
    closeList();
    return out.join('\n');
  }

  $: renderedBody = renderMarkdown(bodyDraft);
</script>

<svelte:head><title>{pack?.name ?? 'Design'} · Cosmos</title></svelte:head>

<header class="page-header reveal reveal-1">
  <a class="crumb" href="/admin/designs">‹ All designs</a>
  <span class="eyebrow">Design system</span>
  {#if loading}
    <h1>Loading…</h1>
  {:else if loadError || !pack}
    <h1>Not found</h1>
    <p class="lede">{loadError ?? `No design at /${slug}.`}</p>
  {:else if isBuiltin}
    <h1>{pack.name}</h1>
    <div class="header-meta">
      <span class="tag accent">built-in</span>
      <span class="slug mono">{pack.slug}</span>
    </div>
  {:else}
    <input
      class="name-input"
      type="text"
      bind:value={nameDraft}
      maxlength="60"
      aria-label="Design name"
      placeholder="Untitled design"
    />
    <div class="header-meta">
      <span class="tag muted">user</span>
      <span class="slug mono">{pack.slug}</span>
      <span class="slug-note">slug is immutable</span>
    </div>
  {/if}
</header>

{#if pack && !loading}
  <div class="layout reveal reveal-2">
    <!-- LEFT: editor -->
    <section class="pane editor-pane">
      <div class="pane-head">
        <span class="eyebrow">Source</span>
        <div class="pane-tools">
          {#if isBuiltin}
            <span class="tag accent">Read-only built-in</span>
          {:else if dirty}
            <span class="tag" title="Unsaved changes">● Unsaved</span>
          {:else}
            <span class="tag muted">Saved</span>
          {/if}
        </div>
      </div>

      {#if saveError}
        <div class="error-banner" role="alert">{saveError}</div>
      {/if}

      <div class="textarea-wrap" class:readonly={isBuiltin}>
        <textarea
          bind:this={textareaEl}
          bind:value={contentDraft}
          on:keydown={onTextareaKey}
          readonly={isBuiltin}
          spellcheck="false"
          aria-label="Design pack source"
        ></textarea>
      </div>

      <div class="editor-actions">
        {#if isBuiltin}
          <button class="primary" on:click={duplicate}>Duplicate as user pack</button>
          <a class="btn ghost" href="/admin/designs">Back</a>
        {:else}
          <button class="primary" on:click={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          <button class="ghost" on:click={duplicate}>Duplicate</button>
          <button
            class={confirmDelete ? 'danger confirming' : 'ghost danger-text'}
            on:click={remove}
          >
            {confirmDelete ? 'Confirm delete' : 'Delete'}
          </button>
          <a class="btn ghost back" href="/admin/designs">Back</a>
        {/if}
      </div>
      <p class="hint-line">
        <span class="mono">⌘S</span> / <span class="mono">Ctrl S</span> saves · <span class="mono">Tab</span> indents two spaces
      </p>
    </section>

    <!-- RIGHT: living preview -->
    <aside class="pane preview-pane">
      <div class="pane-head">
        <span class="eyebrow">Live preview</span>
        <span class="tag muted mono">{pack.slug}</span>
      </div>

      {#if parseErrors.length > 0}
        <div class="parse-warn" role="status">
          <span class="warn-label">Heads up</span>
          <ul>
            {#each parseErrors as e}<li>{e}</li>{/each}
          </ul>
        </div>
      {/if}

      <!-- Specimen poster rendered in the pack's own palette + typography. -->
      <div
        class="specimen"
        style={
          `--pk-bg: ${colorsObj.bg ?? '#111'};` +
          `--pk-surface: ${colorsObj.surface ?? '#222'};` +
          `--pk-accent: ${colorsObj.accent ?? '#ddd'};` +
          `--pk-text: ${colorsObj.text ?? '#fff'};` +
          `--pk-muted: ${colorsObj.muted ?? '#888'};` +
          `--pk-display: ${fontStack(displayFont)};` +
          `--pk-body: ${fontStack(bodyFont)};`
        }
      >
        <div class="spec-head">
          <span class="spec-dot"></span>
          <span class="spec-id mono">{pack.slug}</span>
        </div>
        <div class="spec-display">{asStr(liveFm.name) ?? pack.name}</div>
        {#if asStr(liveFm.description)}
          <div class="spec-desc">{liveFm.description}</div>
        {/if}
        <div class="spec-body">
          The quick brown fox jumps over the lazy dog &mdash; 0123456789
        </div>
      </div>

      {#if colorEntries.length > 0}
        <div class="block">
          <div class="block-head"><span class="eyebrow">Colors</span></div>
          <ul class="color-list">
            {#each colorEntries as [k, v]}
              <li>
                <span class="chip" style="background: {v}"></span>
                <span class="ck">{k}</span>
                <span class="cv mono">{v}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if displayFont || bodyFont}
        <div class="block">
          <div class="block-head"><span class="eyebrow">Typography</span></div>
          {#if displayFont}
            <div class="type-sample" style="font-family: {fontStack(displayFont)};">
              <span class="type-label mono">display · {displayFont}</span>
              <span class="type-line big">Aa Bb Cc</span>
            </div>
          {/if}
          {#if bodyFont}
            <div class="type-sample" style="font-family: {fontStack(bodyFont)};">
              <span class="type-label mono">body · {bodyFont}</span>
              <span class="type-line">The quick brown fox jumps over the lazy dog.</span>
            </div>
          {/if}
        </div>
      {/if}

      {#if spacingEntries.length > 0}
        <div class="block">
          <div class="block-head"><span class="eyebrow">Spacing</span></div>
          <ul class="spacing-list">
            {#each spacingEntries as [k, v]}
              <li>
                <span class="sk mono">{k}</span>
                <span class="sbar" style="width: {spacingToPx(v)}px"></span>
                <span class="sv mono">{v}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="block">
        <div class="block-head"><span class="eyebrow">Body</span></div>
        {#if bodyDraft.trim().length === 0}
          <p class="muted-empty">No body content yet.</p>
        {:else}
          <div class="prose">{@html renderedBody}</div>
        {/if}
      </div>
    </aside>
  </div>
{/if}

<style>
  .page-header { margin-bottom: 1.25rem; }
  .crumb {
    display: inline-block;
    margin-bottom: 0.85rem;
    color: var(--c-fg-3);
    font-size: 0.85rem;
    text-decoration: none;
  }
  .crumb:hover { color: var(--c-fg); }
  .page-header h1 {
    font-size: clamp(1.6rem, 4vw, 2.25rem);
    margin-top: 0.35rem;
  }
  .lede { color: var(--c-fg-2); margin-top: 0.5rem; }
  .header-meta {
    margin-top: 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .slug { color: var(--c-fg-3); font-size: 0.78rem; }
  .slug-note { color: var(--c-fg-3); font-size: 0.75rem; }

  .name-input {
    /* The h1 itself becomes the input — gives the edit page an "in place" feel
       rather than a separate form field for the name. */
    margin-top: 0.35rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--c-fg);
    font-size: clamp(1.6rem, 4vw, 2.25rem);
    font-weight: 600;
    letter-spacing: -0.01em;
    padding: 0.1rem 0.4rem;
    min-height: auto;
    width: 100%;
    transition: border-color 150ms var(--ease), background 150ms var(--ease);
  }
  .name-input:hover { border-color: var(--c-line); }
  .name-input:focus {
    border-color: var(--c-accent);
    background: var(--c-surface);
    box-shadow: 0 0 0 3px var(--c-accent-tint);
  }

  .layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }
  @media (min-width: 960px) {
    .layout {
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
      gap: 1.5rem;
      align-items: start;
    }
  }

  .pane {
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    padding: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-width: 0;
  }
  @media (min-width: 960px) {
    .preview-pane {
      position: sticky;
      top: 5rem;
      max-height: calc(100vh - 6rem);
      overflow: auto;
    }
  }

  .pane-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .pane-tools { display: inline-flex; gap: 0.4rem; align-items: center; }

  .error-banner {
    background: var(--c-danger-tint);
    border: 1px solid var(--c-danger);
    color: var(--c-danger);
    padding: 0.6rem 0.8rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
  }

  .textarea-wrap {
    position: relative;
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: 1px solid var(--c-line);
    background: var(--c-bg);
  }
  .textarea-wrap.readonly { opacity: 0.85; }
  .textarea-wrap textarea {
    /* Override admin defaults to lean into "editor": monospace, dense, generous height. */
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--c-fg);
    font-family: var(--f-mono);
    font-size: 0.85rem;
    line-height: 1.55;
    padding: 1rem 1.1rem;
    min-height: 60vh;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    tab-size: 2;
  }
  .textarea-wrap textarea:focus {
    outline: none;
    box-shadow: none;
  }
  .textarea-wrap:focus-within {
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-tint);
  }

  .editor-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .editor-actions .back { margin-left: auto; text-decoration: none; }
  .editor-actions .danger-text { color: var(--c-danger); border-color: var(--c-line); }
  .editor-actions .danger-text:hover {
    background: var(--c-danger-tint);
    border-color: var(--c-danger);
  }
  .editor-actions .confirming {
    background: var(--c-danger);
    color: var(--c-bg);
    border-color: var(--c-danger);
    animation: pulse-confirm 1.2s var(--ease) infinite;
  }
  @keyframes pulse-confirm {
    0%, 100% { box-shadow: 0 0 0 0 rgba(240, 107, 117, 0.5); }
    50% { box-shadow: 0 0 0 6px rgba(240, 107, 117, 0); }
  }
  .editor-actions .btn { text-decoration: none; }

  .hint-line {
    color: var(--c-fg-3);
    font-size: 0.78rem;
    margin: 0;
  }

  .parse-warn {
    background: var(--c-accent-tint);
    border: 1px solid rgba(255, 209, 122, 0.4);
    border-radius: var(--radius-sm);
    padding: 0.6rem 0.8rem;
    font-size: 0.85rem;
    color: var(--c-fg-2);
  }
  .parse-warn .warn-label {
    display: block;
    color: var(--c-accent);
    font-family: var(--f-mono);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 0.35rem;
  }
  .parse-warn ul { margin: 0; padding-left: 1.1rem; }

  /* Specimen poster — rendered in the *pack's* palette + fonts. */
  .specimen {
    background: var(--pk-bg);
    color: var(--pk-text);
    border-radius: var(--radius-sm);
    padding: 1.5rem 1.5rem 2rem;
    position: relative;
    overflow: hidden;
    border: 1px solid var(--c-line);
    box-shadow: inset 0 -50% 80px -50px rgba(0, 0, 0, 0.3);
  }
  .spec-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }
  .spec-dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 999px;
    background: var(--pk-accent);
    box-shadow: 0 0 14px var(--pk-accent);
  }
  .spec-id {
    font-size: 0.7rem;
    color: var(--pk-muted);
    letter-spacing: 0.06em;
  }
  .spec-display {
    font-family: var(--pk-display);
    font-size: clamp(2.2rem, 6vw, 3.4rem);
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: 1.05;
    color: var(--pk-text);
  }
  .spec-desc {
    margin-top: 0.85rem;
    font-family: var(--pk-body);
    color: var(--pk-accent);
    font-size: 0.95rem;
    line-height: 1.5;
  }
  .spec-body {
    margin-top: 1.25rem;
    font-family: var(--pk-body);
    color: var(--pk-muted);
    font-size: 0.85rem;
    line-height: 1.6;
  }

  .block {
    border-top: 1px solid var(--c-line);
    padding-top: 0.85rem;
  }
  .block-head { margin-bottom: 0.6rem; }

  .color-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.45rem 0.85rem;
  }
  .color-list li {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }
  .chip {
    width: 1rem;
    height: 1rem;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }
  .ck { color: var(--c-fg-2); font-size: 0.85rem; }
  .cv {
    color: var(--c-fg-3);
    font-size: 0.72rem;
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .type-sample {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.65rem 0;
  }
  .type-sample + .type-sample { border-top: 1px dashed var(--c-line); }
  .type-label {
    color: var(--c-fg-3);
    font-size: 0.7rem;
    letter-spacing: 0.06em;
  }
  .type-line {
    color: var(--c-fg);
    font-size: 1.15rem;
    line-height: 1.3;
  }
  .type-line.big {
    font-size: 2rem;
    letter-spacing: -0.02em;
  }

  .spacing-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .spacing-list li {
    display: grid;
    grid-template-columns: 2.5rem 1fr auto;
    align-items: center;
    gap: 0.6rem;
  }
  .sk { color: var(--c-fg-2); font-size: 0.78rem; }
  .sbar {
    height: 6px;
    background: var(--c-accent);
    border-radius: 3px;
    opacity: 0.85;
  }
  .sv { color: var(--c-fg-3); font-size: 0.72rem; }

  .prose {
    color: var(--c-fg-2);
    font-size: 0.9rem;
    line-height: 1.6;
  }
  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3),
  .prose :global(h4) {
    color: var(--c-fg);
    margin: 1rem 0 0.4rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .prose :global(h1) { font-size: 1.15rem; }
  .prose :global(h2) { font-size: 1.02rem; }
  .prose :global(h3) { font-size: 0.92rem; }
  .prose :global(p) { margin: 0.5rem 0; color: var(--c-fg-2); }
  .prose :global(ul) { margin: 0.5rem 0 0.5rem 1.1rem; padding: 0; }
  .prose :global(li) { margin: 0.15rem 0; }
  .prose :global(code) {
    font-family: var(--f-mono);
    font-size: 0.82em;
    background: var(--c-surface-2);
    border: 1px solid var(--c-line);
    padding: 0.05rem 0.35rem;
    border-radius: 0.25rem;
    color: var(--c-fg);
  }
  .prose :global(strong) { color: var(--c-fg); }

  .muted-empty { color: var(--c-fg-3); font-size: 0.85rem; }
</style>
