<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getDisplayName, setDisplayName } from '$lib/storage';
  import { connect, type ServerMessage } from '$lib/ws';

  let name: string | null = null;
  let inputName = '';
  let greeting: string | null = null;
  let error: string | null = null;
  let socket: WebSocket | null = null;

  function handleMessage(msg: ServerMessage) {
    if (msg.type === 'welcome') {
      greeting = msg.message;
      error = null;
    } else {
      error = msg.error;
    }
  }

  function start(n: string) {
    name = n;
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
    const stored = getDisplayName();
    if (stored) start(stored);
  });

  onDestroy(() => {
    socket?.close();
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
  {:else if greeting}
    <h1 style="font-weight:300;font-size:3rem">{greeting}</h1>
  {:else}
    <p style="opacity:0.6">Connecting…</p>
  {/if}
</main>
