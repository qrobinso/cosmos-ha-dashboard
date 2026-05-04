<script lang="ts">
  import type { Background } from '$lib/types';
  import Solid from './Solid.svelte';
  export let background: Background;
</script>

{#if background.type === 'solid'}
  <Solid color={background.color} />
{:else}
  <Solid color="#101010" />
{/if}
