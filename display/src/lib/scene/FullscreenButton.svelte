<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let supported = false;
  let visible = false;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function showBriefly() {
    // Intentional no-op while in fullscreen: once the wall display is in
    // fullscreen we don't want tap-to-reveal an exit affordance — the user
    // can leave via system back/Esc.
    if (document.fullscreenElement) return;
    visible = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (visible = false), 4000);
  }

  async function toggle() {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      /* permission denied or unsupported — surface nothing */
    }
  }

  onMount(() => {
    supported = typeof document.documentElement.requestFullscreen === 'function';
    const wake = () => showBriefly();
    window.addEventListener('pointerdown', wake);
    return () => {
      window.removeEventListener('pointerdown', wake);
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
    aria-label="Enter fullscreen"
    title="Enter fullscreen"
    on:click={toggle}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>
    </svg>
  </button>
{/if}

<style>
  .fs-btn {
    position: fixed;
    inset: 50%;
    transform: translate(-50%, -50%);
    z-index: 9999;
    width: 8rem;
    height: 8rem;
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
    transform: translate(-50%, -50%) scale(1.05);
  }
  .fs-btn.hidden {
    opacity: 0;
    pointer-events: none;
  }
  .fs-btn svg {
    width: 3rem;
    height: 3rem;
  }
</style>
