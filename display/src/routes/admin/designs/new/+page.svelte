<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/admin/api';

  const SLUG_RE = /^[a-z0-9][a-z0-9-]+[a-z0-9]$/;

  let name = '';
  let slug = '';
  // Track whether the user has hand-edited the slug so we stop auto-syncing it
  // from the name. (Once you tweak it, your edits stick.)
  let slugTouched = false;
  let submitting = false;
  let serverError: string | null = null;

  function slugify(input: string): string {
    return input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  $: if (!slugTouched) slug = slugify(name);

  $: nameValid = name.trim().length >= 1 && name.trim().length <= 60;
  $: slugValid = SLUG_RE.test(slug);
  $: canSubmit = nameValid && slugValid && !submitting;

  // Compact starter template — gives structure without prescribing content.
  $: content = `---
name: ${name || 'New Design System'}
description: A short sentence about the mood.
colors:
  bg: "#0f0f12"
  surface: "#1a1a1f"
  accent: "#e0b878"
  text: "#f4f0e8"
  muted: "#8a8780"
typography:
  display:
    fontFamily: Fraunces
    fontWeight: 500
    letterSpacing: "-0.01em"
  body:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 16px
    lineHeight: 1.6
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 32px
  xl: 64px
---

# ${name || 'New Design System'}

A one-paragraph statement of intent. What does a scene in this pack feel like at room distance?

## Overview

What problem does this pack solve? When is it the right pick?

## Colors

- \`bg\` — the dominant field.
- \`surface\` — secondary surface for cards and pulled-out content.
- \`accent\` — the single chromatic note; use sparingly.
- \`text\` — primary foreground.

## Typography

Which font does heavy lifting at distance, and which carries body? Note ideal sizes.

## Layout

Density, spacing scale, focal-element guidance.

## Don't

- Two or three concrete things to avoid.
`;

  async function submit(e: Event) {
    e.preventDefault();
    if (!canSubmit) return;
    submitting = true;
    serverError = null;
    try {
      const created = await api.designs.create({ slug, name: name.trim(), content });
      await goto(`/admin/designs/${created.slug}`);
    } catch (err) {
      serverError = err instanceof Error ? err.message : 'failed to create';
      submitting = false;
    }
  }

  function onSlugInput(e: Event) {
    slugTouched = true;
    slug = (e.target as HTMLInputElement).value;
  }
</script>

<svelte:head><title>New design · Cosmos</title></svelte:head>

<header class="page-header reveal reveal-1">
  <a class="crumb" href="/admin/designs">‹ All designs</a>
  <span class="eyebrow">Design system</span>
  <h1>New design system</h1>
  <p class="lede">
    Give it a name and a slug. We'll start you off with a structured template — frontmatter for
    colors, typography, and spacing, plus prose sections for intent and constraints.
  </p>
</header>

<form class="card reveal reveal-2" on:submit={submit}>
  <div class="row">
    <div class="field">
      <label for="d-name">Name</label>
      <input
        id="d-name"
        type="text"
        bind:value={name}
        placeholder="e.g. Cinema Noir"
        maxlength="60"
        autocomplete="off"
        required
      />
      <span class="hint">Display name. 1–60 characters.</span>
    </div>

    <div class="field">
      <label for="d-slug">Slug</label>
      <input
        id="d-slug"
        type="text"
        value={slug}
        on:input={onSlugInput}
        placeholder="cinema-noir"
        autocomplete="off"
        spellcheck="false"
        required
      />
      <span class="hint" class:hint-err={!slugValid && slug.length > 0}>
        {#if slug.length === 0}
          Lowercase, hyphen-separated (e.g. <span class="mono">cinema-noir</span>).
        {:else if slugValid}
          <span class="ok">✓</span> Valid slug. <span class="mono muted-inline">/admin/designs/{slug}</span>
        {:else}
          Must match <span class="mono">^[a-z0-9][a-z0-9-]+[a-z0-9]$</span> (3–64 chars).
        {/if}
      </span>
    </div>
  </div>

  {#if serverError}
    <div class="server-error" role="alert">{serverError}</div>
  {/if}

  <div class="preview-line">
    <span class="eyebrow">Template preview</span>
    <span class="rule" aria-hidden="true"></span>
  </div>
  <pre class="template-preview" aria-label="Starter template">{content}</pre>
  <p class="note">You'll be able to edit everything immediately after creating.</p>

  <div class="actions">
    <a class="btn ghost" href="/admin/designs">Cancel</a>
    <button class="primary" type="submit" disabled={!canSubmit}>
      {submitting ? 'Creating…' : 'Create design'}
    </button>
  </div>
</form>

<style>
  .page-header {
    margin-bottom: 1.5rem;
  }
  .page-header h1 {
    font-size: clamp(1.6rem, 4vw, 2.25rem);
    margin-top: 0.35rem;
  }
  .crumb {
    display: inline-block;
    margin-bottom: 0.85rem;
    color: var(--c-fg-3);
    font-size: 0.85rem;
    text-decoration: none;
  }
  .crumb:hover { color: var(--c-fg); }
  .lede {
    margin-top: 0.55rem;
    color: var(--c-fg-2);
    max-width: 38rem;
    line-height: 1.55;
  }

  form.card { display: flex; flex-direction: column; gap: 1.25rem; }

  .row {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  @media (min-width: 600px) { .row { grid-template-columns: 1.2fr 1fr; gap: 1.25rem; } }

  .hint .ok { color: var(--c-success); font-weight: 600; }
  .hint .muted-inline { color: var(--c-fg-3); }
  .hint-err { color: var(--c-danger); }

  .server-error {
    background: var(--c-danger-tint);
    border: 1px solid var(--c-danger);
    color: var(--c-danger);
    padding: 0.75rem 0.9rem;
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }

  .preview-line {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .preview-line .rule { flex: 1; height: 1px; background: var(--c-line); }

  .template-preview {
    margin: 0;
    background: var(--c-surface-2);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 1rem 1.1rem;
    color: var(--c-fg-2);
    font-family: var(--f-mono);
    font-size: 0.82rem;
    line-height: 1.55;
    max-height: 22rem;
    overflow: auto;
    white-space: pre;
  }
  .note { color: var(--c-fg-3); font-size: 0.85rem; }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .actions .btn { text-decoration: none; }
</style>
