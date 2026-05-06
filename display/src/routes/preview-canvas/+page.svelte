<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/admin/api';
  import Canvas from '$lib/widgets/Canvas.svelte';
  import type { WidgetState, SceneState } from '$lib/types';

  let widget: WidgetState | null = null;
  let scene: SceneState | null = null;

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return;
    const all = await api.scenes.list();
    for (const s of all) {
      const found = (s.widgets ?? []).find((w: WidgetState) => w.id === id);
      if (found) {
        const cfg = (found.config ?? {}) as { content?: string };
        widget = {
          ...found,
          data: {
            resolved: typeof cfg.content === 'string' ? cfg.content : '',
            liveEntityIds: []
          }
        };
        scene = s as unknown as SceneState;
        return;
      }
    }
  });
</script>

<svelte:head><title>Cosmos — Canvas preview</title></svelte:head>

<main style="position:fixed;inset:0;background:#0a0a0a">
  {#if widget && scene}
    <Canvas {widget} {scene} displayName="preview" entitiesById={new Map()} />
  {:else}
    <div style="display:grid;place-items:center;width:100%;height:100%;color:#888;font-family:system-ui">
      Loading…
    </div>
  {/if}
</main>
