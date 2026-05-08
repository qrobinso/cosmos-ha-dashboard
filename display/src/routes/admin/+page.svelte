<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api } from '$lib/admin/api';

  type Scene = Awaited<ReturnType<typeof api.scenes.list>>[number];
  type Display = Awaited<ReturnType<typeof api.displays.list>>[number];

  let scenes: Scene[] = [];
  let displays: Display[] = [];
  let loading = true;
  let pendingByDisplay: Record<string, string | null> = {};
  /** Only one iframe is mounted at a time. Each kiosk preview opens a fresh
   *  WebSocket and runs the full scene-render pipeline (gradients, mood video,
   *  widgets), so showing 4 of them simultaneously is heavy on a phone. The
   *  user picks which display to inspect by tapping its card. */
  let loadedDisplayId: string | null = null;
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  // 60s online threshold matches the Displays page convention.
  function isOnline(d: Display): boolean {
    if (!d.lastSeen) return false;
    return Date.now() - new Date(d.lastSeen + 'Z').getTime() < 60_000;
  }

  function activeSceneId(d: Display): string | null {
    return d.currentSceneId ?? d.defaultSceneId ?? null;
  }

  async function refresh() {
    const [s, ds] = await Promise.all([api.scenes.list(), api.displays.list()]);
    scenes = s;
    displays = ds;
    loading = false;
  }

  async function activate(displayName: string, displayId: string, sceneId: string) {
    pendingByDisplay = { ...pendingByDisplay, [displayId]: sceneId };
    try {
      await api.displays.activateScene(displayName, sceneId);
      // Optimistic local update so the chip flips immediately; refresh confirms.
      displays = displays.map((d) =>
        d.id === displayId ? { ...d, currentSceneId: sceneId } : d
      );
      // Re-fetch in the background so any server-side enrichment catches up.
      void refresh();
    } catch (err) {
      console.error('activateScene failed', err);
    } finally {
      pendingByDisplay = { ...pendingByDisplay, [displayId]: null };
    }
  }

  function previewSrc(d: Display): string {
    // ?display=<name> opens the kiosk in preview mode without overwriting
    // the iframe's localStorage. The iframe connects via WS as that display
    // (sharing the connection set with the real tablet) and re-renders
    // automatically when scenes change.
    return `/?display=${encodeURIComponent(d.name)}`;
  }

  function togglePreview(displayId: string) {
    loadedDisplayId = loadedDisplayId === displayId ? null : displayId;
  }

  function openPreviewWindow(d: Display) {
    const portrait = d.orientation === 'portrait';
    const w = portrait ? 540 : 960;
    const h = portrait ? 960 : 540;
    window.open(
      previewSrc(d),
      `cosmos-preview-${d.name}`,
      `width=${w},height=${h},noopener`
    );
  }

  // Online/last-seen state drifts in the background; refresh quietly.
  onMount(async () => {
    await refresh();
    pollHandle = setInterval(() => { void refresh(); }, 15_000);
  });
  onDestroy(() => { if (pollHandle) clearInterval(pollHandle); });

  /** Sort online devices first so the user sees what's live without scrolling.
   *  Within each group, preserve the API's natural order (creation time). */
  $: sortedDisplays = [...displays].sort((a, b) => {
    const ao = isOnline(a) ? 0 : 1;
    const bo = isOnline(b) ? 0 : 1;
    return ao - bo;
  });
</script>

<header class="hero reveal reveal-1">
  <h1>Overview</h1>
  <a class="agent-cta" href="/admin/agent">
    <span class="agent-cta-icon" aria-hidden="true">✨</span>
    <span class="agent-cta-label">Ask the agent</span>
    <span class="agent-cta-arrow" aria-hidden="true">→</span>
  </a>
</header>

{#if loading}
  <p class="loading">Loading…</p>
{:else}
  {#if displays.length === 0}
    <section class="empty-card reveal reveal-2">
      <h2>No displays yet</h2>
      <p>Open <span class="mono">http://&lt;host&gt;:8099/</span> on a wall tablet to register your first display.</p>
    </section>
  {:else}
    <section
      class="display-grid reveal reveal-2"
      class:single={displays.length === 1}
      class:dense={displays.length >= 3}
    >
      {#each sortedDisplays as d (d.id)}
        {@const online = isOnline(d)}
        {@const activeId = activeSceneId(d)}
        {@const isPortrait = d.orientation === 'portrait'}
        <article class="panel" class:portrait={isPortrait} class:offline={!online}>
          <header class="panel-head">
            <div class="title">
              <span class="dot" class:online></span>
              <span class="name">{d.name}</span>
            </div>
            <div class="meta">
              <span class="tag muted">{d.orientation}</span>
              {#if !online}<span class="tag muted">offline</span>{/if}
              <button
                type="button"
                class="popout"
                title="Open preview in a new window"
                aria-label={`Open ${d.name} preview in a new window`}
                on:click={() => openPreviewWindow(d)}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9 2h5v5 M14 2L8 8 M13 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"
                  />
                </svg>
              </button>
            </div>
          </header>

          <div class="frame" class:portrait={isPortrait}>
            {#if loadedDisplayId === d.id}
              <iframe
                title={`Live preview — ${d.name}`}
                src={previewSrc(d)}
              ></iframe>
              <!-- Click-shield: clicks land on this overlay (which then
                   unloads the preview) instead of inside the kiosk. -->
              <button
                type="button"
                class="shield loaded"
                aria-label="Hide preview"
                on:click={() => togglePreview(d.id)}
              ></button>
              <button
                type="button"
                class="close"
                aria-label="Hide preview"
                on:click={() => togglePreview(d.id)}
              >×</button>
            {:else}
              <button
                type="button"
                class="placeholder"
                on:click={() => togglePreview(d.id)}
                aria-label={`Load live preview of ${d.name}`}
              >
                <span class="play" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22">
                    <path d="M8 5v14l11-7z" fill="currentColor"/>
                  </svg>
                </span>
                <span class="placeholder-label">Tap to load preview</span>
                <span class="placeholder-hint">One frame at a time</span>
              </button>
            {/if}
          </div>

          <div class="chips" role="group" aria-label="Switch scene">
            {#if scenes.length === 0}
              <a class="chip ghost" href="/admin/scenes">Create a scene →</a>
            {:else}
              {#each scenes as s (s.id)}
                {@const isActive = s.id === activeId}
                {@const isPending = pendingByDisplay[d.id] === s.id}
                <button
                  type="button"
                  class="chip"
                  class:active={isActive}
                  class:pending={isPending}
                  on:click={() => activate(d.name, d.id, s.id)}
                  disabled={isActive || isPending}
                  title={isActive ? `${s.name} (active)` : `Switch to ${s.name}`}
                >
                  <span class="chip-dot" aria-hidden="true"></span>
                  <span class="chip-label">{s.name}</span>
                </button>
              {/each}
            {/if}
          </div>

          {#if activeId}
            {@const activeScene = scenes.find((s) => s.id === activeId)}
            {#if activeScene}
              <a class="edit-link" href={`/admin/scenes/${activeScene.id}`}>
                Edit "{activeScene.name}" →
              </a>
            {/if}
          {/if}
        </article>
      {/each}
    </section>
  {/if}
{/if}

<style>
  .hero {
    margin-bottom: 2rem;
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

  .agent-cta {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: 0.4rem;
    padding: 0.65rem 1.1rem;
    border-radius: 999px;
    background: var(--c-accent-tint);
    border: 1px solid var(--c-accent);
    color: var(--c-fg);
    font-weight: 500;
    font-size: 0.95rem;
    text-decoration: none;
    transition: background 150ms var(--ease), transform 150ms var(--ease);
  }
  .agent-cta:hover { background: color-mix(in srgb, var(--c-accent) 25%, var(--c-surface)); transform: translateY(-1px); }
  .agent-cta-arrow { transition: transform 200ms var(--ease); }
  .agent-cta:hover .agent-cta-arrow { transform: translateX(2px); }
  @media (max-width: 480px) {
    .agent-cta { width: 100%; justify-content: center; align-self: stretch; }
  }

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

  /* Display grid: 1 column on phones, 2 above 800px, max 2 even at desktop
     because each panel's preview already wants generous space. With 3+ displays
     we tighten things slightly (.dense) so they don't sprawl. */
  .display-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }
  @media (min-width: 800px) {
    .display-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem; }
    .display-grid.single { grid-template-columns: minmax(0, 1fr); }
  }

  .panel {
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-lg);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    /* Soft cool wash on the panel rim — picks up the favicon arc color so each
       panel feels lit by the same atmosphere as the page. */
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.02) inset,
      0 12px 40px rgba(0, 0, 0, 0.35);
    transition: opacity 200ms var(--ease);
  }
  /* Offline panels dim the surface — content stays readable + interactive,
     but the eye lands on online displays first. */
  .panel.offline { opacity: 0.62; }
  .panel.offline:hover { opacity: 0.85; }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    font-size: 1rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }
  /* Compact icon button (overrides the global 44px touch-target rule, which
     is meant for chrome-level controls — this lives inside a card header). */
  .popout {
    width: 1.85rem;
    height: 1.85rem;
    min-height: 0;
    padding: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--c-line);
    color: var(--c-fg-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 150ms var(--ease), color 150ms var(--ease), border-color 150ms var(--ease);
  }
  .popout:hover {
    background: var(--c-surface-hover);
    color: var(--c-accent);
    border-color: rgba(255, 209, 122, 0.4);
  }

  /* Frame: holds the iframe at the display's natural aspect ratio. Landscape
     defaults to 16:9; portrait flips to 9:16. The preview is "kiosk-shaped"
     so users see the same composition the wall device shows. */
  .frame {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: #000;
    border: 1px solid var(--c-line);
  }
  .frame.portrait {
    aspect-ratio: 9 / 16;
    max-width: 22rem;
    margin: 0 auto;
  }
  .frame iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    /* The kiosk renders at the iframe size; container queries inside widgets
       handle scaling so no extra zoom math is needed here. */
  }
  .frame .shield.loaded {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    /* No min-height here — overrides the global button rule. */
    min-height: 0;
  }
  .frame .close {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 2rem;
    height: 2rem;
    min-height: 0;
    padding: 0;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #fff;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    z-index: 2;
    transition: background 150ms var(--ease), transform 150ms var(--ease);
  }
  .frame .close:hover {
    background: rgba(0, 0, 0, 0.8);
    transform: scale(1.05);
  }

  /* Placeholder: a calm, cosmic invitation to load the preview. Picks up the
     same atmospheric gradients as the page so it feels like part of the
     ambient field rather than a missing image. */
  .frame .placeholder {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background:
      radial-gradient(ellipse 60% 45% at 75% 65%, rgba(255, 209, 122, 0.12), transparent 60%),
      radial-gradient(ellipse 80% 60% at 25% 30%, rgba(168, 166, 255, 0.10), transparent 60%),
      linear-gradient(180deg, #11141d 0%, #06080f 100%);
    color: var(--c-fg);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    transition: filter 200ms var(--ease);
  }
  .frame .placeholder:hover { filter: brightness(1.15); }
  .frame .placeholder .play {
    width: 3.25rem;
    height: 3.25rem;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 209, 122, 0.45);
    color: var(--c-accent);
    box-shadow: 0 0 24px rgba(255, 209, 122, 0.18);
    margin-bottom: 0.25rem;
    transition: transform 200ms var(--ease), box-shadow 200ms var(--ease);
  }
  .frame .placeholder:hover .play {
    transform: scale(1.08);
    box-shadow: 0 0 32px rgba(255, 209, 122, 0.32);
  }
  .frame .placeholder-label {
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--c-fg);
  }
  .frame .placeholder-hint {
    font-size: 0.78rem;
    color: var(--c-fg-3);
  }

  /* Chips: scene switcher under each preview. Active = warm-gold action color.
     Inactive = neutral surface with hover lift. Pending = subtle pulse. */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.75rem;
    min-height: 0;
    height: auto;
    border-radius: 999px;
    background: var(--c-surface-2);
    border: 1px solid var(--c-line);
    color: var(--c-fg-2);
    font-family: var(--f-sans);
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 150ms var(--ease), color 150ms var(--ease), border-color 150ms var(--ease), transform 150ms var(--ease);
  }
  .chip:hover:not(:disabled):not(.active) {
    background: var(--c-surface-hover);
    color: var(--c-fg);
    border-color: var(--c-line-strong);
    transform: translateY(-1px);
  }
  .chip:disabled { cursor: default; }
  .chip.active {
    background: var(--c-accent-tint);
    border-color: rgba(255, 209, 122, 0.45);
    color: var(--c-accent);
  }
  .chip.active .chip-dot {
    background: var(--c-accent);
    box-shadow: 0 0 0 2px rgba(255, 209, 122, 0.25);
  }
  .chip.pending { animation: chip-pulse 800ms ease-in-out infinite; }
  .chip-dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 999px;
    background: var(--c-fg-3);
    flex-shrink: 0;
  }
  .chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 14rem;
  }
  .chip.ghost {
    text-decoration: none;
    color: var(--c-cool);
    border-style: dashed;
  }
  @keyframes chip-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }

  .edit-link {
    margin-top: 0.15rem;
    font-size: 0.85rem;
    color: var(--c-fg-2);
    align-self: flex-start;
  }
  .edit-link:hover { color: var(--c-accent); }

  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: var(--c-fg-3);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
  }
  .dot.online {
    background: var(--c-success);
    box-shadow: 0 0 0 2px rgba(109, 213, 140, 0.18);
  }

</style>
