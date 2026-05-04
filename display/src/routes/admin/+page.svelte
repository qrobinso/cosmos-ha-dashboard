<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/admin/api';

  let scenesCount = 0;
  let displaysCount = 0;
  let loading = true;

  onMount(async () => {
    const [scenes, displays] = await Promise.all([api.scenes.list(), api.displays.list()]);
    scenesCount = scenes.length;
    displaysCount = displays.length;
    loading = false;
  });
</script>

<h1>Cosmos Admin</h1>
<p>Configure scenes, displays, and global settings.</p>

{#if loading}
  <p>Loading…</p>
{:else}
  <div class="cards">
    <a class="card" href="/admin/scenes">
      <span class="count">{scenesCount}</span>
      <span class="label">Scenes</span>
    </a>
    <a class="card" href="/admin/displays">
      <span class="count">{displaysCount}</span>
      <span class="label">Displays</span>
    </a>
    <a class="card" href="/admin/settings">
      <span class="count">⚙️</span>
      <span class="label">Settings</span>
    </a>
  </div>
{/if}

<style>
  h1 {
    margin: 0 0 0.5rem;
    font-weight: 300;
  }
  p {
    color: #aaa;
    margin: 0 0 2rem;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 1rem;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 2rem 1rem;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 0.75rem;
    color: inherit;
    text-decoration: none;
    transition: background 150ms ease;
  }
  .card:hover {
    background: #222;
  }
  .count {
    font-size: 2.5rem;
    font-weight: 200;
  }
  .label {
    font-size: 0.95rem;
    color: #aaa;
  }
</style>
