<script lang="ts">
  import { fade } from 'svelte/transition';

  export let colors: string[];
  export let speed: 'slow' | 'medium' | 'fast' = 'medium';
  export let style: 'mesh' | 'linear' | 'radial' = 'mesh';
  /** Crossfade duration when `colors` or `style` changes. Sourced from
   *  the global transition-speed multiplier via SceneState. */
  export let fadeMs: number = 800;

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

  $: bgImage = gradientCss(cssColors, style);
  // Any change to colors or style flips the key, which causes Svelte to
  // run `out:fade` on the existing .gradient-bg AND `in:fade` on the new
  // one in parallel — producing a crossfade. The .drift wrapper sits
  // OUTSIDE the keyed block so the continuous translate animation never
  // restarts; both layers ride the same drift transform.
  $: bgKey = bgImage;
</script>

<div class="gradient-clip">
  <div class="drift" style={`--cosmos-grad-duration: ${durationS}s;`}>
    {#key bgKey}
      <div
        class="gradient-bg"
        style={`background-image: ${bgImage};`}
        in:fade={{ duration: fadeMs }}
        out:fade={{ duration: fadeMs }}
      ></div>
    {/key}
  </div>
</div>

<style>
  /* The drift animation drives `transform` (a composite-only property)
     on an oversized wrapper so the GPU handles motion without repainting
     the gradient every frame — important for 24/7 displays. The keyed
     .gradient-bg children inherit this transform; mounting/unmounting
     them does not affect the wrapper, so the drift never restarts. */
  .gradient-clip {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .drift {
    position: absolute;
    /* 1.4× viewport so we can drift up to ~20% in any direction without exposing edges. */
    top: -20%;
    left: -20%;
    width: 140%;
    height: 140%;
    transform: translate3d(0, 0, 0);
    animation: cosmos-gradient-drift var(--cosmos-grad-duration) ease-in-out infinite alternate;
    will-change: transform;
  }
  .gradient-bg {
    position: absolute;
    inset: 0;
    background-size: 100% 100%;
  }
  @keyframes cosmos-gradient-drift {
    0%   { transform: translate3d(0%, 0%, 0); }
    50%  { transform: translate3d(8%, 4%, 0); }
    100% { transform: translate3d(-4%, 8%, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .drift {
      animation: none;
      transform: translate3d(0, 0, 0);
    }
  }
</style>
