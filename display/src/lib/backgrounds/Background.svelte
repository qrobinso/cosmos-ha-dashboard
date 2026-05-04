<script lang="ts">
  import type { Background } from '$lib/types';
  import Solid from './Solid.svelte';
  import Gradient from './Gradient.svelte';
  export let background: Background;
</script>

{#if background.type === 'solid'}
  <Solid color={background.color} />
{:else if background.type === 'gradient'}
  <Gradient colors={background.colors} speed={background.speed} style={background.style} />
{/if}
