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

<div
  class="gradient-bg"
  style={`--cosmos-grad: ${gradientCss(cssColors, style)}; --cosmos-grad-duration: ${durationS}s;`}
></div>

<style>
  .gradient-bg {
    position: absolute;
    inset: 0;
    background-image: var(--cosmos-grad);
    background-size: 200% 200%;
    background-position: 0% 0%;
    animation: cosmos-gradient-drift var(--cosmos-grad-duration) ease-in-out infinite alternate;
    will-change: background-position;
  }
  @keyframes cosmos-gradient-drift {
    0%   { background-position: 0% 0%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 50% 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gradient-bg {
      animation: none;
      background-position: 0% 0%;
    }
  }
</style>
