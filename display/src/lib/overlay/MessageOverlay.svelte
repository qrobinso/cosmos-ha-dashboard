<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { OverlayMessage } from '$lib/types';

  export let overlay: OverlayMessage | null = null;
  export let onDismiss: () => void = () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;

  $: if (overlay && overlay.timeout_ms && overlay.timeout_ms > 0) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onDismiss(), overlay.timeout_ms);
  }

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });

  function dismiss() {
    if (timer) clearTimeout(timer);
    onDismiss();
  }
</script>

{#if overlay}
  <button class="overlay-toast" on:click={dismiss} aria-live="polite">
    {#if overlay.icon}
      <span class="icon" aria-hidden="true">{overlay.icon}</span>
    {/if}
    <span class="text">
      <span class="title">{overlay.title}</span>
      {#if overlay.body}
        <span class="body">{overlay.body}</span>
      {/if}
    </span>
  </button>
{/if}

<style>
  .overlay-toast {
    position: fixed;
    z-index: 100;
    left: 50%;
    top: 2rem;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    border: none;
    border-radius: 1rem;
    background: rgba(20, 20, 28, 0.92);
    color: #f5f5f5;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    font-family: inherit;
    cursor: pointer;
    animation: cosmos-overlay-in 350ms ease-out;
  }
  .icon {
    font-size: 1.5rem;
  }
  .text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    text-align: left;
  }
  .title {
    font-size: 1.05rem;
    font-weight: 500;
  }
  .body {
    font-size: 0.9rem;
    opacity: 0.75;
  }
  @keyframes cosmos-overlay-in {
    from { opacity: 0; transform: translate(-50%, -1rem); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .overlay-toast {
      animation: none;
    }
  }
</style>
