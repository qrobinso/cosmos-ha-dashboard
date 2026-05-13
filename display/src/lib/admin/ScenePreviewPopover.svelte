<!--
  Floating (desktop hover) or modal (touch tap) live preview of a scene.
  Embeds the read-only kiosk renderer at `/admin/scenes/<id>/preview` in an
  <iframe>, sized to the scene's grid aspect ratio. Driven entirely by props;
  dispatches `close` when the user dismisses a modal (the popover variant just
  unmounts when the parent's hover state ends).
-->
<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { base } from '$app/paths';

  /** Scene id — used to build the preview iframe URL. */
  export let sceneId: string;
  /** Scene name — iframe title / aria. */
  export let sceneName: string;
  /** Grid aspect ratio (cols / rows). Keeps the iframe's cells square. */
  export let aspect: number = 1.5;
  /** `popover` floats next to `anchor` (desktop hover); `modal` is centered with a backdrop (touch). */
  export let mode: 'popover' | 'modal' = 'popover';
  /** Bounding rect of the thumbnail the popover should sit beside. Required for `popover` mode. */
  export let anchor: DOMRect | null = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  const GAP = 12;
  const MARGIN = 12;

  // Computed popover box. Recomputed on mount + viewport changes.
  let box = { left: 0, top: 0, width: 0, height: 0 };

  function clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v));
  }

  function place() {
    if (mode !== 'popover' || !anchor) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let width = Math.min(440, vw - MARGIN * 2);
    let height = width / aspect;
    if (height > vh - MARGIN * 2) {
      height = vh - MARGIN * 2;
      width = height * aspect;
    }
    // Prefer to the right of the thumbnail; fall back to below, then above.
    let left = anchor.right + GAP;
    let top = anchor.top + anchor.height / 2 - height / 2;
    if (left + width > vw - MARGIN) {
      left = clamp(anchor.left, MARGIN, vw - width - MARGIN);
      top = anchor.bottom + GAP;
      if (top + height > vh - MARGIN) top = anchor.top - GAP - height;
    }
    left = clamp(left, MARGIN, vw - width - MARGIN);
    top = clamp(top, MARGIN, vh - height - MARGIN);
    box = { left, top, width, height };
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') dispatch('close');
  }

  let closeBtn: HTMLButtonElement | undefined;

  onMount(() => {
    place();
    const onViewport = () => (mode === 'popover' ? dispatch('close') : place());
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport, true);
    window.addEventListener('keydown', onKeydown);
    if (mode === 'modal') closeBtn?.focus();
    return () => {
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
      window.removeEventListener('keydown', onKeydown);
    };
  });

  $: src = `${base}/admin/scenes/${encodeURIComponent(sceneId)}/preview`;
</script>

{#if mode === 'modal'}
  <div
    class="backdrop"
    role="presentation"
    on:click|self={() => dispatch('close')}
  >
    <div
      class="modal-panel"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${sceneName}`}
      style="aspect-ratio: {aspect};"
    >
      <iframe {src} title={`Preview of ${sceneName}`} loading="lazy"></iframe>
      <button class="close" bind:this={closeBtn} on:click={() => dispatch('close')} aria-label="Close preview">×</button>
      <div class="modal-foot">
        <span class="modal-title">{sceneName}</span>
        <a class="edit-link" href="{base}/admin/scenes/{sceneId}">Open editor →</a>
      </div>
    </div>
  </div>
{:else if anchor}
  <div
    class="popover"
    role="img"
    aria-label={`Preview of ${sceneName}`}
    style="left:{box.left}px; top:{box.top}px; width:{box.width}px; height:{box.height}px;"
  >
    <iframe {src} title={`Preview of ${sceneName}`} loading="lazy"></iframe>
  </div>
{/if}

<style>
  .popover {
    position: fixed;
    z-index: 1000;
    border-radius: var(--radius-md, 0.6rem);
    overflow: hidden;
    border: 1px solid var(--c-line-strong, rgba(255, 255, 255, 0.2));
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.4);
    background: #0a0a0a;
    pointer-events: none; /* hover-only — never steals the mouse from the thumb */
  }
  .popover iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.62);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    padding: 1rem;
  }
  .modal-panel {
    position: relative;
    width: min(94vw, 760px);
    max-height: 86vh;
    border-radius: var(--radius-md, 0.6rem);
    overflow: hidden;
    border: 1px solid var(--c-line-strong, rgba(255, 255, 255, 0.2));
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
    background: #0a0a0a;
  }
  .modal-panel iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
  .close {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    width: 2rem;
    height: 2rem;
    min-height: 2rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 1.2rem;
    line-height: 1;
    cursor: pointer;
    display: grid;
    place-items: center;
    backdrop-filter: blur(2px);
  }
  .close:hover { background: rgba(0, 0, 0, 0.75); }
  .modal-foot {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.85rem;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0));
    color: rgba(255, 255, 255, 0.9);
    font-family: var(--f-sans, system-ui), system-ui, sans-serif;
    font-size: 0.85rem;
  }
  .modal-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .edit-link {
    flex-shrink: 0;
    color: #fff;
    text-decoration: none;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: 0.35rem;
    background: rgba(255, 255, 255, 0.12);
  }
  .edit-link:hover { background: rgba(255, 255, 255, 0.2); }
</style>
