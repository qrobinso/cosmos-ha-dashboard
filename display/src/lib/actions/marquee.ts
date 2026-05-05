/**
 * Svelte action that turns a single-line text container into an endless
 * left-scrolling marquee when its content overflows. No-op when text fits.
 *
 * Usage:
 *   <div class="title" use:marquee><span>{longText}</span></div>
 *
 * The host MUST contain a single child element (typically <span>) wrapping
 * the text. On init the action wraps that child in a `.cosmos-marquee-track`
 * flex container; when overflow is detected it clones the child onto the
 * track so the animation can translate the strip by `(textWidth + gap)` and
 * loop seamlessly — the clone slides into the original's position with no
 * visible jump.
 *
 * The host gets `overflow: hidden; white-space: nowrap; min-width: 0` on
 * init so `scrollWidth` reports the natural unclipped content width.
 */
export function marquee(node: HTMLElement) {
  let raf = 0;
  let lastDistance = -1;
  let lastText = '';
  let clone: HTMLElement | null = null;

  const original = node.firstElementChild as HTMLElement | null;
  if (!original) return {};

  // Wrap the original child in a track. We translate the track as a unit;
  // when overflow we append a clone to it so the animation can scroll
  // from 0 to -(originalWidth + gap) and loop with the clone in place.
  const track = document.createElement('div');
  track.classList.add('cosmos-marquee-track');
  track.style.display = 'inline-flex';
  track.style.alignItems = 'center';
  track.style.whiteSpace = 'nowrap';
  node.insertBefore(track, original);
  track.appendChild(original);

  // Host layout — required for measurement and clipping.
  node.style.overflow = 'hidden';
  node.style.whiteSpace = 'nowrap';
  node.style.minWidth = '0';
  if (!node.style.display) node.style.display = 'block';

  // Inline-block + flex-shrink-disabled so scrollWidth is reliable and the
  // clone doesn't get squeezed.
  original.style.display = 'inline-block';
  original.style.whiteSpace = 'nowrap';
  original.style.flex = '0 0 auto';

  function check() {
    const overflow = original.scrollWidth > node.clientWidth;
    const currentText = original.textContent ?? '';

    if (overflow) {
      // Ensure clone exists and tracks the original's text.
      if (!clone) {
        clone = original.cloneNode(true) as HTMLElement;
        clone.setAttribute('aria-hidden', 'true');
        clone.style.flex = '0 0 auto';
        track.appendChild(clone);
      } else if (currentText !== lastText) {
        clone.textContent = currentText;
      }
      lastText = currentText;

      const gap = 48; // px between original and clone
      track.style.gap = `${gap}px`;
      const distance = original.scrollWidth + gap;
      if (distance !== lastDistance) {
        lastDistance = distance;
        node.style.setProperty('--cosmos-marquee-distance', `${distance}px`);
        // ~60 px/sec, with a sane minimum so very short overflows don't sprint.
        const duration = Math.max(6, distance / 60);
        node.style.setProperty('--cosmos-marquee-duration', `${duration}s`);
      }
      if (!node.classList.contains('cosmos-marquee-active')) {
        node.classList.add('cosmos-marquee-active');
      }
    } else {
      if (clone) {
        clone.remove();
        clone = null;
      }
      lastDistance = -1;
      node.classList.remove('cosmos-marquee-active');
    }
  }

  function schedule() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(check);
  }

  const ro = new ResizeObserver(schedule);
  ro.observe(node);
  ro.observe(original);

  // Re-check when the text content inside `original` changes.
  const mo = new MutationObserver(schedule);
  mo.observe(original, { childList: true, characterData: true, subtree: true });

  schedule();
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(schedule).catch(() => {});
  }

  return {
    update: schedule,
    destroy() {
      ro.disconnect();
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
