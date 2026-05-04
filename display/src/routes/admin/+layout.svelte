<script lang="ts">
  import '$lib/admin/theme.css';
  import { page } from '$app/stores';

  const links = [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/scenes', label: 'Scenes' },
    { href: '/admin/displays', label: 'Displays' },
    { href: '/admin/settings', label: 'Settings' },
  ];

  $: pathname = $page.url.pathname;
  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  let menuOpen = false;
  function closeMenu() { menuOpen = false; }
</script>

<div class="cosmos-admin">
  <header class="topbar">
    <a href="/admin" class="brand" on:click={closeMenu}>
      <span class="dot" aria-hidden="true"></span>
      <span class="brand-text">Cosmos</span>
    </a>

    <nav class="desktop-nav" aria-label="Primary">
      {#each links as link (link.href)}
        <a href={link.href} class:active={isActive(link.href)}>{link.label}</a>
      {/each}
    </nav>

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
      {#each links as link (link.href)}
        <a href={link.href} class:active={isActive(link.href)} on:click={closeMenu}>
          <span>{link.label}</span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      {/each}
    </div>
  {/if}

  <main class="admin-main">
    <slot />
  </main>
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
    background: rgba(12, 13, 18, 0.85);
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
  .brand .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 999px;
    background: radial-gradient(circle at 30% 30%, var(--c-accent), #b85a1e 75%);
    box-shadow: 0 0 12px rgba(243, 162, 106, 0.55);
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

  @media (min-width: 720px) {
    .desktop-nav { display: flex; }
    .menu-toggle { display: none; }
    .topbar { padding: 1rem 2rem; }
  }
</style>
