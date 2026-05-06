<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { WidgetState, CanvasData, EntityState, SceneState } from '$lib/types';
  import { CANVAS_BRIDGE_SCRIPT } from './canvasBridge';

  export let widget: WidgetState;
  export let scene: SceneState;
  export let displayName: string;

  $: data = (widget.data as CanvasData | null) ?? { resolved: '', liveEntityIds: [] };
  $: content = data.resolved;

  let iframeEl: HTMLIFrameElement;
  let wrapperEl: HTMLDivElement;
  let resizeObs: ResizeObserver | null = null;
  let lastEntityById = new Map<string, EntityState>();
  let extraSubscribed = new Set<string>();
  let prevContent: string | undefined;
  $: if (content !== prevContent) {
    extraSubscribed = new Set();
    prevContent = content;
  }

  function buildSrcdoc(html: string): string {
    return CANVAS_BRIDGE_SCRIPT + (html || '');
  }

  function context() {
    const w = wrapperEl?.clientWidth ?? 0;
    const h = wrapperEl?.clientHeight ?? 0;
    const fontFamily = (typeof document !== 'undefined'
      ? getComputedStyle(document.body).fontFamily
      : 'system-ui') || 'system-ui';
    const fontScale = Number(
      (typeof document !== 'undefined'
        ? getComputedStyle(document.body).getPropertyValue('--cosmos-font-scale')
        : '1') || '1',
    ) || 1;
    return {
      size: { w, h },
      scene: { id: scene.id, name: scene.name },
      font: { family: fontFamily, scale: fontScale },
    };
  }

  function postInit(entities: EntityState[]) {
    iframeEl?.contentWindow?.postMessage(
      { type: 'cosmos:init', context: context(), entities },
      '*',
    );
  }

  function postContext() {
    iframeEl?.contentWindow?.postMessage({ type: 'cosmos:context', context: context() }, '*');
  }

  function postState(entity: EntityState) {
    iframeEl?.contentWindow?.postMessage({ type: 'cosmos:state', entity }, '*');
  }

  function onMessage(ev: MessageEvent) {
    if (ev.source !== iframeEl?.contentWindow) return;
    const msg = ev.data as { type?: string; entity_ids?: unknown };
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'cosmos:ready') {
      postInit(Array.from(lastEntityById.values()));
      return;
    }
    if (msg.type === 'cosmos:want-entity') {
      const ids = Array.isArray(msg.entity_ids)
        ? msg.entity_ids.filter((x): x is string => typeof x === 'string')
        : [];
      const fresh = ids.filter((id) => !extraSubscribed.has(id));
      if (fresh.length === 0) return;
      for (const id of fresh) extraSubscribed.add(id);
      void fetch(`/api/canvases/${encodeURIComponent(widget.id)}/subscribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, entity_ids: fresh }),
      }).catch(() => {});
    }
  }

  $: if (data.liveEntityIds && iframeEl) {
    void data.liveEntityIds;
  }

  export function forwardEntity(entity: EntityState) {
    lastEntityById.set(entity.entity_id, entity);
    postState(entity);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('message', onMessage);
  }

  onMount(() => {
    resizeObs = new ResizeObserver(() => postContext());
    if (wrapperEl) resizeObs.observe(wrapperEl);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', onMessage);
    }
    resizeObs?.disconnect();
  });
</script>

<div class="canvas-wrap" bind:this={wrapperEl}>
  {#key content}
    <iframe
      bind:this={iframeEl}
      class="canvas-iframe"
      title="Cosmos canvas"
      sandbox="allow-scripts"
      srcdoc={buildSrcdoc(content)}
      referrerpolicy="no-referrer"
    ></iframe>
  {/key}
</div>

<style>
  .canvas-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: var(--cosmos-widget-radius, 0.75rem);
  }
  .canvas-iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    display: block;
  }
</style>
