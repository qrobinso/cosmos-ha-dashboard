<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/admin/api';

  let scenesCount = 0;
  let displaysCount = 0;
  let onlineCount = 0;
  let recentScenes: Awaited<ReturnType<typeof api.scenes.list>> = [];
  let displays: Awaited<ReturnType<typeof api.displays.list>> = [];
  let loading = true;

  onMount(async () => {
    const [scenes, ds] = await Promise.all([api.scenes.list(), api.displays.list()]);
    scenesCount = scenes.length;
    displaysCount = ds.length;
    onlineCount = ds.filter((d) => {
      if (!d.lastSeen) return false;
      const seen = new Date(d.lastSeen + 'Z').getTime();
      return Date.now() - seen < 60_000;
    }).length;
    recentScenes = scenes.slice(0, 5);
    displays = ds;
    loading = false;
  });

  function sceneNameFor(id: string | null): string | null {
    if (!id) return null;
    return recentScenes.find((s) => s.id === id)?.name ?? null;
  }
</script>

<header class="hero reveal reveal-1">
  <span class="eyebrow">Overview</span>
  <h1>Configure your wall display.</h1>
  <p>Manage scenes, displays, and global settings. Changes go live across every connected device.</p>
</header>

{#if loading}
  <p class="loading">Loading…</p>
{:else}
  <section class="stats reveal reveal-2">
    <a class="stat" href="/admin/scenes">
      <span class="stat-label">Scenes</span>
      <span class="stat-value">{scenesCount}</span>
      <span class="stat-foot">Manage layouts &amp; widgets</span>
    </a>
    <a class="stat" href="/admin/displays">
      <span class="stat-label">Displays</span>
      <span class="stat-value">{displaysCount}</span>
      <span class="stat-foot">
        {#if displaysCount > 0}
          <span class="dot online"></span>
          {onlineCount} online now
        {:else}
          Connect a device to begin
        {/if}
      </span>
    </a>
    <a class="stat" href="/admin/settings">
      <span class="stat-label">Settings</span>
      <span class="stat-value">⚙</span>
      <span class="stat-foot">Safe-area &amp; advanced</span>
    </a>
  </section>

  <section class="split">
    <div class="card reveal reveal-3">
      <header class="card-head">
        <h2>Recent scenes</h2>
        <a href="/admin/scenes" class="more">View all →</a>
      </header>
      {#if recentScenes.length === 0}
        <p class="empty">No scenes yet. <a href="/admin/scenes">Create your first one</a>.</p>
      {:else}
        <ul class="list">
          {#each recentScenes as s (s.id)}
            <li>
              <a href={`/admin/scenes/${s.id}`}>
                <span class="row-name">{s.name}</span>
                <span class="row-meta">
                  <span class="tag muted">{s.background.type}</span>
                  <span class="tag muted">{s.widgets.length} widgets</span>
                </span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="card reveal reveal-4">
      <header class="card-head">
        <h2>Displays</h2>
        <a href="/admin/displays" class="more">View all →</a>
      </header>
      {#if displays.length === 0}
        <p class="empty">No displays yet. Open <span class="mono">http://&lt;host&gt;:8099/</span> on a device to register.</p>
      {:else}
        <ul class="list">
          {#each displays as d (d.id)}
            {@const isOnline = d.lastSeen ? Date.now() - new Date(d.lastSeen + 'Z').getTime() < 60_000 : false}
            <li>
              <span class="row-name">
                <span class="dot" class:online={isOnline}></span>
                {d.name}
              </span>
              <span class="row-meta">
                {#if sceneNameFor(d.currentSceneId)}
                  <span class="tag accent">{sceneNameFor(d.currentSceneId)}</span>
                {:else if sceneNameFor(d.defaultSceneId)}
                  <span class="tag">{sceneNameFor(d.defaultSceneId)}</span>
                {:else}
                  <span class="tag muted">no scene</span>
                {/if}
                <span class="tag muted">{d.orientation}</span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>
{/if}

<style>
  .hero {
    margin-bottom: 2.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 38rem;
  }
  .hero h1 {
    font-size: clamp(1.6rem, 4vw, 2.25rem);
    line-height: 1.15;
  }
  .hero p { font-size: 1rem; }

  .loading { color: var(--c-fg-3); }

  .stats {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 1.25rem;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: var(--c-fg);
    transition: background 150ms var(--ease), border-color 150ms var(--ease), transform 150ms var(--ease);
  }
  .stat:hover {
    background: var(--c-surface-hover);
    border-color: var(--c-line-strong);
    transform: translateY(-1px);
  }
  .stat-label {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--c-fg-3);
  }
  .stat-value {
    font-size: 2.5rem;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--c-fg);
  }
  .stat-foot {
    font-size: 0.85rem;
    color: var(--c-fg-2);
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .split {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 1rem;
    gap: 1rem;
  }
  .more { font-size: 0.85rem; color: var(--c-fg-2); white-space: nowrap; }
  .more:hover { color: var(--c-accent); }

  .empty { color: var(--c-fg-3); margin: 0.5rem 0; }
  .empty a { color: var(--c-accent); }

  .list { list-style: none; padding: 0; margin: 0; }
  .list li {
    border-top: 1px solid var(--c-line);
  }
  .list li:first-child { border-top: 0; }
  .list a, .list li > span:first-child {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 0;
    color: var(--c-fg);
    text-decoration: none;
    gap: 0.75rem;
  }
  .list li > span:first-child + .row-meta { padding: 0.85rem 0; }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 0;
  }
  .list li:first-child { padding-top: 0; }
  .list li a { padding: 0; }

  .row-name {
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-meta {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: var(--c-fg-3);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.04);
  }
  .dot.online {
    background: var(--c-success);
    box-shadow: 0 0 0 2px rgba(109, 213, 140, 0.18);
  }

  @media (min-width: 600px) {
    .stats { grid-template-columns: repeat(3, 1fr); }
  }
  @media (min-width: 900px) {
    .split { grid-template-columns: 1fr 1fr; gap: 1.25rem; }
  }
</style>
