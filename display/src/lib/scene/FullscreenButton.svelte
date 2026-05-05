<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let supported = false;
  let isFullscreen = false;
  let visible = true;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function readState() {
    isFullscreen = !!document.fullscreenElement;
  }

  function showBriefly() {
    visible = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (visible = false), 4000);
  }

  async function toggle() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* permission denied or unsupported — surface nothing */
    }
  }

  onMount(() => {
    supported = typeof document.documentElement.requestFullscreen === 'function';
    readState();
    document.addEventListener('fullscreenchange', readState);
    // Show on any first interaction (touch/click/keyboard) to remind
    // tablet users the button exists, then fade away.
    const wake = () => showBriefly();
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    showBriefly();
    return () => {
      document.removeEventListener('fullscreenchange', readState);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  });

  onDestroy(() => {
    if (hideTimer) clearTimeout(hideTimer);
  });
</script>

{#if supported}
  <button
    class="fs-btn"
    class:hidden={!visible}
    type="button"
    aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
    title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
    on:click={toggle}
  >
    {#if isFullscreen}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>
      </svg>
    {/if}
  </button>
{/if}

<style>
  .fs-btn {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    z-index: 9999;
    width: 2.75rem;
    height: 2.75rem;
    display: grid;
    place-items: center;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(0, 0, 0, 0.45);
    color: #f5f5f5;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    backdrop-filter: blur(8px);
    transition: opacity 350ms ease, transform 350ms ease;
    opacity: 0.9;
  }
  .fs-btn:hover {
    opacity: 1;
    transform: scale(1.05);
  }
  .fs-btn.hidden {
    opacity: 0;
    pointer-events: none;
  }
  .fs-btn svg {
    width: 1.25rem;
    height: 1.25rem;
  }
</style>
