<script lang="ts">
  import Field from '$lib/admin/Field.svelte';
  import Section from './Section.svelte';
  import type { EntityState } from '$lib/types';
  // Vite imports raw markdown as a string with the `?raw` suffix.
  import canvasHelpRaw from '$lib/admin/canvas-help.md?raw';

  export let config: Record<string, unknown>;
  // Accepted for a uniform component contract; canvas has no entity binding.
  export let entities: EntityState[] = [];
  $: void entities;

  // Tiny markdown → HTML pass: paragraph + heading + code block + table only.
  const canvasHelpHtml = canvasHelpRaw
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/```([\s\S]*?)```/g, (_m, body) => `<pre><code>${body.trim().replace(/</g, '&lt;')}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\| (.+) \|$/gm, (line) => {
      if (/^\|[\s\-:|]+\|$/.test(line)) return '';
      return '<tr>' + line.slice(2, -2).split(' | ').map((c) => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/(\n<tr>.*<\/tr>)+/gs, (block) => `<table>${block}</table>`);

  function str(key: string): string {
    const v = config[key];
    return typeof v === 'string' ? v : '';
  }
  function set(key: string, value: unknown) {
    config = { ...config, [key]: value };
  }

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
</script>

<Section label="Content">
  <Field label="Content (HTML / CSS / JS)">
    <div class="toolbar">
      <span class="help-tip" tabindex="0" role="button" aria-label="How this works" aria-describedby="canvas-help-tooltip">
        ⓘ How this works
        <span class="help-tooltip" id="canvas-help-tooltip" role="tooltip">
          {@html canvasHelpHtml}
        </span>
      </span>
    </div>
    <textarea
      rows="14"
      class="canvas-content"
      placeholder="Type or paste HTML/CSS/JS. Use {'{{'} states('sensor.foo') {'}}'} for live values."
      value={str('content')}
      on:input={(e) => set('content', e.currentTarget.value)}
      on:keydown={canvasTabHandler}
    ></textarea>
    <span class="hint-line">{str('content').length.toLocaleString()} chars · soft limit ~50,000.</span>
  </Field>
</Section>

<style>
  .toolbar {
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
    font-family: var(--f-mono);
    font-size: 0.82rem;
    line-height: 1.5;
    tab-size: 2;
  }
  .hint-line {
    font-size: 0.8rem;
    color: var(--c-fg-3);
  }
  .help-tip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.55rem;
    border-radius: 999px;
    font-size: 0.8rem;
    color: var(--c-fg-2);
    cursor: help;
    user-select: none;
    border: 1px solid var(--c-line);
    background: var(--c-surface-2);
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
    background: var(--c-surface);
    color: var(--c-fg-2);
    border: 1px solid var(--c-line-strong);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    font-size: 0.82rem;
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
  .help-tooltip :global(h1) { font-size: 1rem; margin: 0.1rem 0 0.4rem; color: var(--c-fg); }
  .help-tooltip :global(h2) { font-size: 0.9rem; margin: 0.6rem 0 0.3rem; color: var(--c-fg); }
  .help-tooltip :global(h3) { font-size: 0.85rem; margin: 0.5rem 0 0.25rem; color: var(--c-fg-2); }
  .help-tooltip :global(table) { width: 100%; border-collapse: collapse; margin: 0.4rem 0; font-size: 0.78rem; }
  .help-tooltip :global(td) { padding: 0.2rem 0.4rem; border-bottom: 1px solid var(--c-line); vertical-align: top; }
  .help-tooltip :global(code), .help-tooltip :global(pre) {
    background: var(--c-surface-2);
    padding: 0.05rem 0.3rem;
    border-radius: var(--r-1);
    font-family: var(--f-mono);
  }
  .help-tooltip :global(pre) { padding: 0.6rem 0.85rem; overflow-x: auto; }
</style>
