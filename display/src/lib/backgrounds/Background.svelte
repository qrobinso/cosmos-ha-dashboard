<script lang="ts">
  import type { AerialClip, Background } from '$lib/types';
  import Solid from './Solid.svelte';
  import Gradient from './Gradient.svelte';
  import Aerials from './Aerials.svelte';
  export let background: Background;
  export let fadeMs: number = 800;
  /** Server-resolved playlist for `aerials` backgrounds. */
  export let aerialClips: AerialClip[] = [];
</script>

{#if background.type === 'solid'}
  <Solid color={background.color} />
{:else if background.type === 'gradient'}
  <Gradient colors={background.colors} speed={background.speed} style={background.style} {fadeMs} />
{:else if background.type === 'aerials'}
  <Aerials
    clips={aerialClips}
    shuffle={background.shuffle ?? false}
    intervalMin={background.interval_min ?? 30}
    {fadeMs}
  />
{/if}
