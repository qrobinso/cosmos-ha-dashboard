<!--
  Read-only, full-viewport render of one scene using the kiosk's <SceneCanvas>.
  The `@` in the filename resets this route to the root layout (fonts +
  keyframes only) so it escapes the admin chrome — same shell the wall display
  uses. Loaded directly for debugging, and embedded as an <iframe> by the
  admin scenes list's hover/tap preview.

  No WebSocket, no transitions: it fetches `GET /api/scenes/:id/preview` once
  (an assembled SceneState — real HA data when connected, mock otherwise) and
  mounts it. Canvas widgets render with their {{ }} templates unsubstituted
  (the preview endpoint deliberately skips the stateful canvas resolver).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import type { SceneState } from '$lib/types';
  import SceneCanvas from '$lib/scene/SceneCanvas.svelte';

  let state: SceneState | null = null;
  let error: string | null = null;

  onMount(async () => {
    const id = $page.params.id;
    try {
      const res = await fetch(`/api/scenes/${encodeURIComponent(id)}/preview`);
      if (!res.ok) {
        error = res.status === 404 ? 'Scene not found.' : `Couldn't load preview (HTTP ${res.status}).`;
        return;
      }
      state = (await res.json()) as SceneState;
    } catch {
      error = "Couldn't reach the server.";
    }
  });
</script>

{#if state}
  <!-- displayName="" so canvas widgets don't register iframe-side entity
       subscriptions against a phantom display name. -->
  <SceneCanvas scene={state} displayName="" />
{:else if error}
  <div class="preview-msg">{error}</div>
{:else}
  <div class="preview-msg">Loading preview…</div>
{/if}

<style>
  .preview-msg {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: #0a0a0a;
    color: rgba(255, 255, 255, 0.6);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 0.9rem;
  }
</style>
