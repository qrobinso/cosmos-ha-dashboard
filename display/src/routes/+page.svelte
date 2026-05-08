<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getDisplayName, setDisplayName } from '$lib/storage';
  import { setDisplayName as setReportDisplayName } from '$lib/scene/reportPalette';
  import { connect, type ServerMessage, type Orientation } from '$lib/ws';
  import type { SceneState } from '$lib/types';
  import TransitionStage from '$lib/scene/TransitionStage.svelte';
  import type { TransitionDescriptor } from '$lib/transitions/types';
  import MessageOverlay from '$lib/overlay/MessageOverlay.svelte';
  import FullscreenButton from '$lib/scene/FullscreenButton.svelte';
  import type { OverlayMessage } from '$lib/types';

  let name: string | null = null;
  let inputName = '';
  let greeting: string | null = null;
  let scene: SceneState | null = null;
  let error: string | null = null;
  let socket: { close(): void } | null = null;
  let pendingTransition: TransitionDescriptor | null = null;
  let overlay: OverlayMessage | null = null;
  let orientation: Orientation = 'landscape';

  $: if (typeof document !== 'undefined') {
    document.body.dataset.orientation = orientation;
  }

  function handleMessage(msg: ServerMessage) {
    if (msg.type === 'welcome') {
      greeting = msg.message;
      error = null;
    } else if (msg.type === 'display_config') {
      orientation = msg.config.orientation;
    } else if (msg.type === 'scene') {
      pendingTransition = msg.transition ?? null;
      scene = msg.state;
      error = null;
    } else if (msg.type === 'overlay') {
      overlay = msg.overlay;
    } else if (msg.type === 'overlay_dismiss') {
      overlay = null;
    } else {
      error = msg.error;
    }
  }

  function start(n: string) {
    name = n;
    setReportDisplayName(n);
    socket = connect(n, handleMessage);
  }

  function submitOnboarding(e: Event) {
    e.preventDefault();
    const trimmed = inputName.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
    start(trimmed);
  }

  onMount(() => {
    // ?display=<name> launches a one-shot preview without overwriting the
    // device's saved display name. Useful for the admin Preview button.
    const params = new URLSearchParams(window.location.search);
    const previewName = params.get('display')?.trim();
    if (previewName) {
      start(previewName);
      return;
    }
    const stored = getDisplayName();
    if (stored) start(stored);
  });

  onDestroy(() => {
    socket?.close();
    setReportDisplayName(null);
  });
</script>

<main style="display:grid;place-items:center;min-height:100vh;text-align:center;padding:2rem">
  {#if !name}
    <form on:submit={submitOnboarding} style="display:grid;gap:1rem;max-width:24rem;width:100%">
      <h1 style="margin:0;font-weight:300">Name this display</h1>
      <input
        bind:value={inputName}
        placeholder="e.g. Living Room"
        autofocus
        style="font-size:1.25rem;padding:0.75rem;border-radius:0.5rem;border:1px solid #333;background:#111;color:inherit"
      />
      <button
        type="submit"
        style="font-size:1.1rem;padding:0.75rem;border-radius:0.5rem;border:none;background:#f5f5f5;color:#0a0a0a;cursor:pointer"
      >
        Continue
      </button>
    </form>
  {:else if error}
    <p style="color:#ff8a8a">Error: {error}</p>
  {:else if scene}
    <TransitionStage {scene} transition={pendingTransition} displayName={name} />
    <MessageOverlay {overlay} onDismiss={() => (overlay = null)} />
  {:else if greeting}
    <h1 style="font-weight:300;font-size:3rem">{greeting}</h1>
  {:else}
    <p style="opacity:0.6">Connecting…</p>
  {/if}
</main>

{#if name}
  <FullscreenButton />
{/if}
