<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let container: HTMLDivElement;
  let inner: HTMLDivElement;
  let scale = 1;
  let resizeObs: ResizeObserver | undefined;
  let mutObs: MutationObserver | undefined;
  let raf = 0;
  // Safety margin for subpixel rounding so glyph anti-aliasing never spills past the cell edge.
  const SAFETY = 0.985;

  function measure() {
    if (!container || !inner) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!cw || !ch) return;
    // Reset transform so we read the unscaled natural content size.
    const prev = inner.style.transform;
    inner.style.transform = 'none';
    // Force a reflow read.
    const iw = inner.offsetWidth;
    const ih = inner.offsetHeight;
    inner.style.transform = prev;
    if (!iw || !ih) return;
    const s = Math.min(cw / iw, ch / ih, 1) * SAFETY;
    scale = isFinite(s) && s > 0 ? s : 1;
  }

  function fit() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      measure();
    });
  }

  function fitWithRetries() {
    fit();
    // Multiple delayed passes to catch late layout work (font swap, orientation
    // rotation, transition end). Each call is a no-op if nothing changed.
    setTimeout(fit, 50);
    setTimeout(fit, 200);
    setTimeout(fit, 500);
  }

  onMount(() => {
    resizeObs = new ResizeObserver(fit);
    resizeObs.observe(container);
    resizeObs.observe(inner);
    // Watching the body catches orientation flips (body width/height swap).
    if (document.body) resizeObs.observe(document.body);
    mutObs = new MutationObserver(fit);
    mutObs.observe(inner, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fitWithRetries);
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(fit);
    }
    fitWithRetries();
  });

  onDestroy(() => {
    resizeObs?.disconnect();
    mutObs?.disconnect();
    window.removeEventListener('resize', fit);
    window.removeEventListener('orientationchange', fitWithRetries);
    if (raf) cancelAnimationFrame(raf);
  });
</script>

<div class="fit" bind:this={container}>
  <div class="fit-inner" bind:this={inner} style="transform: scale({scale});">
    <slot />
  </div>
</div>

<style>
  .fit {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .fit-inner {
    /* inline-block sizes to natural content (no implicit width fill, no clamp by parent). */
    display: inline-block;
    transform-origin: center center;
    will-change: transform;
  }
</style>
