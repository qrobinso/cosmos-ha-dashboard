<script lang="ts">
  export let colors: string[];
  export let speed: 'slow' | 'medium' | 'fast' = 'medium';
  export let style: 'mesh' | 'linear' | 'radial' = 'mesh';

  $: cssColors = colors.length > 0 ? colors : ['#1a1a2e', '#16213e', '#0f3460'];
  $: durationS = speed === 'slow' ? 60 : speed === 'fast' ? 12 : 30;

  function gradientCss(stops: string[], style: 'mesh' | 'linear' | 'radial'): string {
    const list = stops.join(', ');
    if (style === 'linear') return `linear-gradient(135deg, ${list})`;
    if (style === 'radial') return `radial-gradient(circle at 30% 30%, ${list})`;
    // mesh: layered radial gradients for that flowing-blob look
    const layers = stops.map((c, i) => {
      const x = (17 * (i + 1)) % 100;
      const y = (29 * (i + 1)) % 100;
      return `radial-gradient(at ${x}% ${y}%, ${c} 0px, transparent 50%)`;
    });
    return layers.join(', ');
  }
</script>

<div class="gradient-clip">
  <div
    class="gradient-bg"
    style={`background-image: ${gradientCss(cssColors, style)}; --cosmos-grad-duration: ${durationS}s;`}
  ></div>
</div>

<style>
  /* The animation drives `transform` (a composite-only property) on an
     oversized inner layer so the GPU compositor handles motion without
     repainting the gradient every frame — important for 24/7 displays. */
  .gradient-clip {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .gradient-bg {
    position: absolute;
    /* 1.4× viewport so we can drift up to ~20% in any direction without exposing edges. */
    top: -20%;
    left: -20%;
    width: 140%;
    height: 140%;
    background-size: 100% 100%;
    transform: translate3d(0, 0, 0);
    animation: cosmos-gradient-drift var(--cosmos-grad-duration) ease-in-out infinite alternate;
    will-change: transform;
  }
  @keyframes cosmos-gradient-drift {
    0%   { transform: translate3d(0%, 0%, 0); }
    50%  { transform: translate3d(8%, 4%, 0); }
    100% { transform: translate3d(-4%, 8%, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .gradient-bg {
      animation: none;
      transform: translate3d(0, 0, 0);
    }
  }
</style>
