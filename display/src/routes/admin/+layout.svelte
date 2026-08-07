<script lang="ts">
  import '$lib/admin/theme.css';
  import { page } from '$app/stores';
  import Chat from '$lib/admin/Chat.svelte';
  import { agentOpen } from '$lib/admin/agentPanel';

  /*
   * Three destinations, not eight.
   *
   * The admin has exactly three nouns: what to show (Scenes), where to show
   * it (Displays), and how the system runs (Settings). Designs and Music
   * Video are specialist tools that serve Scenes, so they sit as section tabs
   * beneath it rather than competing with it. Agent is a chat — a companion
   * you want open WHILE looking at something, so it is a slide-over, not a
   * destination. Docs is reference material, so it is an icon.
   *
   * Overview stays reachable by clicking the brand mark.
   */
  const links = [
    { href: '/admin/scenes', label: 'Scenes' },
    { href: '/admin/displays', label: 'Displays' },
    { href: '/admin/settings', label: 'Settings' },
  ];

  /** Pages that belong to the Scenes section, shown as tabs within it. */
  const sceneTabs = [
    { href: '/admin/scenes', label: 'Scenes' },
    { href: '/admin/designs', label: 'Designs' },
    { href: '/admin/musicvideo', label: 'Music Video' },
  ];

  $: pathname = $page.url.pathname;

  /** Scenes stays lit while you are in any of its section tabs. */
  function isActive(href: string, path: string): boolean {
    if (href === '/admin/scenes') {
      return sceneTabs.some((t) => path.startsWith(t.href));
    }
    return path.startsWith(href);
  }

  // Precompute active state per link reactively. Inlining the comparison here ensures
  // the template tracks `pathname` as a dependency — a function call would hide it.
  $: navLinks = links.map((l) => ({ ...l, active: isActive(l.href, pathname) }));
  $: inScenesSection = sceneTabs.some((t) => pathname.startsWith(t.href));
  $: sectionTabs = sceneTabs.map((t) => ({ ...t, active: pathname.startsWith(t.href) }));

  let menuOpen = false;
  function closeMenu() { menuOpen = false; }


  const COSMOS_VERSION = __COSMOS_VERSION__;
  const COSMOS_REPO_URL = 'https://github.com/qrobinso/cosmos-ha-dashboard';
</script>

<div class="cosmos-admin">
  <header class="topbar">
    <a href="/admin" class="brand" on:click={closeMenu}>
      <!-- Inline favicon: same SVG, same gradients. Rendering the literal mark
           (rather than approximating with a CSS dot) keeps the topbar and the
           browser tab in lock-step. -->
      <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <radialGradient id="brand-bg" cx="42%" cy="36%" r="78%">
            <stop offset="0%" stop-color="#1a2340" />
            <stop offset="55%" stop-color="#0c111e" />
            <stop offset="100%" stop-color="#06080f" />
          </radialGradient>
          <linearGradient id="brand-arc" x1="10%" y1="10%" x2="80%" y2="92%">
            <stop offset="0%" stop-color="#8fb6ef" />
            <stop offset="45%" stop-color="#a8a6ff" />
            <stop offset="100%" stop-color="#5fd3a3" />
          </linearGradient>
          <radialGradient id="brand-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ffd58a" stop-opacity="0.55" />
            <stop offset="50%" stop-color="#f0c14b" stop-opacity="0.18" />
            <stop offset="100%" stop-color="#f0c14b" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect width="64" height="64" rx="14" ry="14" fill="url(#brand-bg)" />
        <circle cx="44" cy="32" r="12" fill="url(#brand-halo)" />
        <path
          d="M 47.59 23 A 18 18 0 1 0 47.59 41"
          fill="none"
          stroke="url(#brand-arc)"
          stroke-width="9"
          stroke-linecap="round"
        />
        <circle cx="44" cy="32" r="4" fill="#ffd17a" />
        <circle cx="44" cy="32" r="1.6" fill="#fff5db" />
      </svg>
      <span class="brand-text">Cosmos</span>
    </a>

    <nav class="desktop-nav" aria-label="Primary">
      {#each navLinks as link (link.href)}
        <a href={link.href} class:active={link.active} aria-current={link.active ? 'page' : undefined}>{link.label}</a>
      {/each}
    </nav>

    <div class="utilities">
      <button
        class="util"
        type="button"
        aria-label="Ask the agent"
        aria-expanded={$agentOpen}
        title="Ask the agent"
        on:click={() => agentOpen.set(!$agentOpen)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        </svg>
      </button>
      <a class="util" href="/admin/docs" aria-label="Docs" title="Docs" on:click={closeMenu}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.2a2.5 2.5 0 1 1 3.2 2.9c-.6.2-.9.7-.9 1.3v.4" />
          <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      </a>
    </div>

    <button
      class="menu-toggle"
      type="button"
      aria-label={menuOpen ? 'Close menu' : 'Open menu'}
      aria-expanded={menuOpen}
      on:click={() => (menuOpen = !menuOpen)}
    >
      <span class="bar" class:open={menuOpen}></span>
      <span class="bar" class:open={menuOpen}></span>
      <span class="bar" class:open={menuOpen}></span>
    </button>
  </header>

  {#if menuOpen}
    <div class="mobile-menu" role="dialog" aria-modal="false">
      <a href="/admin" class:active={pathname === '/admin'} on:click={closeMenu}>
        <span>Overview</span><span class="chev" aria-hidden="true">›</span>
      </a>
      {#each navLinks as link (link.href)}
        <a
          href={link.href}
          class:active={link.active}
          aria-current={link.active ? 'page' : undefined}
          on:click={closeMenu}
        >
          <span>{link.label}</span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
        {#if link.href === '/admin/scenes'}
          <!-- Section tabs are not reachable from a collapsed bar, so the
               sheet lists them inline rather than hiding them a level down. -->
          {#each sceneTabs.slice(1) as tab (tab.href)}
            <a
              href={tab.href}
              class="sub"
              class:active={pathname.startsWith(tab.href)}
              on:click={closeMenu}
            >
              <span>{tab.label}</span><span class="chev" aria-hidden="true">›</span>
            </a>
          {/each}
        {/if}
      {/each}
      <a href="/admin/docs" class:active={pathname.startsWith('/admin/docs')} on:click={closeMenu}>
        <span>Docs</span><span class="chev" aria-hidden="true">›</span>
      </a>
    </div>
  {/if}

  {#if inScenesSection}
    <nav class="section-tabs" aria-label="Scenes section">
      {#each sectionTabs as tab (tab.href)}
        <a href={tab.href} class:active={tab.active} aria-current={tab.active ? 'page' : undefined}>
          {tab.label}
        </a>
      {/each}
    </nav>
  {/if}

  {#if $agentOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="agent-scrim" on:click={() => agentOpen.set(false)}></div>
    <aside class="agent-panel" aria-label="Agent">
      <button class="agent-close" type="button" aria-label="Close agent" on:click={() => agentOpen.set(false)}>×</button>
      <Chat />
    </aside>
  {/if}

  <main class="admin-main">
    <slot />
  </main>

  <footer class="admin-footer">
    <span class="version">v{COSMOS_VERSION}</span>
    <span class="dot" aria-hidden="true">·</span>
    <a href={COSMOS_REPO_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
  </footer>
</div>

<style>
  :global(html),
  :global(body) {
    height: auto;
    overflow: auto;
  }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.25rem;
    background: rgba(8, 9, 15, 0.78);
    backdrop-filter: saturate(140%) blur(10px);
    -webkit-backdrop-filter: saturate(140%) blur(10px);
    border-bottom: 1px solid var(--c-line);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--c-fg);
    font-weight: 600;
    font-size: 1rem;
    letter-spacing: -0.01em;
    text-decoration: none;
  }
  .brand:hover { color: var(--c-fg); }
  .brand-mark {
    width: 1.75rem;
    height: 1.75rem;
    display: block;
    /* Soft halo outside the SVG so the mark feels lit on the topbar. */
    filter: drop-shadow(0 0 10px rgba(255, 209, 122, 0.18));
    transition: filter 240ms var(--ease);
  }
  .brand:hover .brand-mark {
    filter: drop-shadow(0 0 14px rgba(255, 209, 122, 0.35));
  }

  /* Utility cluster: things that are not destinations. Icon-only so they read
     as tools rather than competing with the three primary nav items. */
  .utilities {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
    margin-right: 0.5rem;
  }
  .utilities .util {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--tap);
    height: var(--tap);
    border-radius: 999px;
    background: none;
    border: none;
    color: var(--c-fg-3);
    cursor: pointer;
    padding: 0;
    transition: background 150ms var(--ease), color 150ms var(--ease);
  }
  .utilities .util:hover { background: var(--c-surface-2); color: var(--c-fg); }
  .utilities .util svg {
    width: 1.15rem;
    height: 1.15rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Section tabs sit under the topbar, scoped to the Scenes section. A second
     row rather than a dropdown: it survives touch and the narrow HA sidebar,
     and it keeps the current section visible instead of hidden behind a menu. */
  .section-tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.5rem 1.25rem 0;
    max-width: 64rem;
    margin: 0 auto;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .section-tabs::-webkit-scrollbar { display: none; }
  .section-tabs a {
    flex: none;
    padding: 0.5rem 0.85rem;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    color: var(--c-fg-3);
    font-size: 0.9rem;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    transition: color 150ms var(--ease), border-color 150ms var(--ease);
  }
  .section-tabs a:hover { color: var(--c-fg-2); }
  .section-tabs a.active {
    color: var(--c-fg);
    border-bottom-color: var(--c-accent);
  }

  /* Agent slide-over. A chat is something you want open WHILE looking at a
     scene, so it overlays rather than navigating away. */
  .agent-scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
    background: rgba(4, 5, 10, 0.55);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
  }
  .agent-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 31;
    width: min(32rem, 100%);
    display: flex;
    flex-direction: column;
    background: var(--c-bg);
    border-left: 1px solid var(--c-line);
    box-shadow: -18px 0 48px rgba(0, 0, 0, 0.45);
    animation: agent-in 220ms var(--ease);
  }
  @keyframes agent-in {
    from { transform: translateX(12px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .agent-panel { animation: none; }
  }
  .agent-close {
    position: absolute;
    top: 0.5rem;
    right: 0.75rem;
    z-index: 1;
    width: 2.25rem;
    height: 2.25rem;
    min-height: 0;
    border: none;
    background: none;
    color: var(--c-fg-3);
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 999px;
  }
  .agent-close:hover { background: var(--c-surface-2); color: var(--c-fg); }
  /* Chat sizes itself to the viewport for its full-page route; inside the
     panel it must fill the panel instead. */
  .agent-panel :global(.chat) {
    height: 100%;
    max-width: none;
    padding: 1rem;
  }

  .mobile-menu a.sub {
    padding-left: 2rem;
    font-size: 0.9rem;
    color: var(--c-fg-3);
  }

  .desktop-nav {
    display: none;
    gap: 0.4rem;
  }
  .desktop-nav a {
    padding: 0.55rem 0.9rem;
    border-radius: 999px;
    color: var(--c-fg-2);
    font-size: 0.92rem;
    transition: background 150ms var(--ease), color 150ms var(--ease);
  }
  .desktop-nav a:hover { background: var(--c-surface-2); color: var(--c-fg); }
  .desktop-nav a.active {
    color: var(--c-fg);
    background: var(--c-accent-tint);
  }

  .menu-toggle {
    display: inline-flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 5px;
    width: 44px;
    height: 44px;
    min-height: 44px;
    background: transparent;
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0;
    cursor: pointer;
  }
  .menu-toggle .bar {
    display: block;
    width: 18px;
    height: 1.5px;
    background: var(--c-fg);
    border-radius: 1px;
    transition: transform 200ms var(--ease), opacity 150ms var(--ease);
  }
  .menu-toggle .bar.open:nth-child(1) { transform: translateY(6.5px) rotate(45deg); }
  .menu-toggle .bar.open:nth-child(2) { opacity: 0; }
  .menu-toggle .bar.open:nth-child(3) { transform: translateY(-6.5px) rotate(-45deg); }

  .mobile-menu {
    position: sticky;
    top: 60px;
    z-index: 19;
    display: flex;
    flex-direction: column;
    background: var(--c-surface);
    border-bottom: 1px solid var(--c-line);
  }
  .mobile-menu a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    color: var(--c-fg);
    border-bottom: 1px solid var(--c-line);
    font-size: 1rem;
    text-decoration: none;
  }
  .mobile-menu a.active { color: var(--c-accent); }
  .mobile-menu a:last-child { border-bottom: 0; }
  .mobile-menu .chev { color: var(--c-fg-3); font-size: 1.25rem; }

  .admin-main {
    max-width: 64rem;
    margin: 0 auto;
    padding: clamp(1rem, 4vw, 2rem);
    box-sizing: border-box;
  }

  .admin-footer {
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.25rem clamp(1rem, 4vw, 2rem) 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: var(--c-fg-3);
    font-size: 0.82rem;
    border-top: 1px solid var(--c-line);
    margin-top: 2rem;
  }
  .admin-footer .version {
    font-family: ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.02em;
  }
  .admin-footer .dot { color: var(--c-fg-3); opacity: 0.5; }
  .admin-footer a {
    color: var(--c-fg-2);
    text-decoration: none;
    transition: color 150ms var(--ease);
  }
  .admin-footer a:hover { color: var(--c-fg); }

  @media (min-width: 720px) {
    .desktop-nav { display: flex; }
    .menu-toggle { display: none; }
    .topbar { padding: 1rem 2rem; }
  }
</style>
