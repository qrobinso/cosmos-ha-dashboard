<script lang="ts">
  import type { Background } from '$lib/types';
  import Solid from './Solid.svelte';
  import Gradient from './Gradient.svelte';
  export let background: Background;
  export let fadeMs: number = 800;
</script>

{#if background.type === 'solid'}
  <Solid color={background.color} />
{:else if background.type === 'gradient'}
  <Gradient colors={background.colors} speed={background.speed} style={background.style} {fadeMs} />
{/if}
