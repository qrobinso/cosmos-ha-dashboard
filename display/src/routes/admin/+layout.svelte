<script lang="ts">
  import { page } from '$app/stores';

  const links = [
    { href: '/admin', label: 'Home' },
    { href: '/admin/scenes', label: 'Scenes' },
    { href: '/admin/displays', label: 'Displays' },
    { href: '/admin/settings', label: 'Settings' },
  ];

  $: pathname = $page.url.pathname;
  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }
</script>

<div class="admin-shell">
  <header class="admin-header">
    <span class="brand">Cosmos · Admin</span>
    <nav>
      {#each links as link (link.href)}
        <a href={link.href} class:active={isActive(link.href)}>{link.label}</a>
      {/each}
    </nav>
  </header>
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
  .admin-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: #111;
    color: #eee;
    font-family: system-ui, sans-serif;
  }
  .admin-header {
    display: flex;
    align-items: center;
    gap: 2rem;
    padding: 0.85rem 1.25rem;
    background: #1a1a1a;
    border-bottom: 1px solid #2a2a2a;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .brand {
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  nav {
    display: flex;
    gap: 1.25rem;
  }
  nav a {
    color: #aaa;
    text-decoration: none;
    font-size: 0.95rem;
  }
  nav a.active {
    color: #fff;
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .admin-main {
    flex: 1;
    padding: 1.5rem;
    max-width: 60rem;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }
</style>
