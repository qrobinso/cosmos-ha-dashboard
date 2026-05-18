<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  export let pxPerHour: number;
  function currentMin(): number { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  let nowMin = currentMin();
  let timer: ReturnType<typeof setInterval>;
  onMount(() => { timer = setInterval(() => { nowMin = currentMin(); }, 60_000); });
  onDestroy(() => clearInterval(timer));
  $: top = (nowMin / 60) * pxPerHour;
</script>
<div class="now" style="top: {top}px">
  <span class="dot"></span>
</div>
<style>
  .now { position: absolute; left: 0; right: 0; height: 0; border-top: 1.5px solid var(--c-accent, #ff6a3d); pointer-events: none; z-index: 5; }
  .dot { position: absolute; left: -4px; top: -4.5px; width: 8px; height: 8px; border-radius: 999px; background: var(--c-accent, #ff6a3d); }
</style>
