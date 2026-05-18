<script lang="ts">
  import type { WidgetState } from '$lib/types';
  export let widget: WidgetState;
  $: cfg = widget.config as Record<string, unknown>;
  $: view = cfg?.view ?? 'view';
</script>
<div class="placeholder">{view} (coming next)</div>
<style>.placeholder { padding: 1rem; opacity: 0.6; font-size: 0.9rem; }</style>
