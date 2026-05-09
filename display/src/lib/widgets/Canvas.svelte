<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { WidgetState, CanvasData, EntityState, SceneState, CanvasFetchPolicy } from '$lib/types';
  import { CANVAS_BRIDGE_SCRIPT } from './canvasBridge';
  import { isHostAllowed } from './canvasFetchPolicy';
  import { reportWidgetPalette } from '$lib/scene/reportPalette';
  import { pickContrastColor } from '$lib/scene/contrastColor';

  export let widget: WidgetState;
  export let scene: SceneState;
  export let displayName: string;
  export let entitiesById: Map<string, import('$lib/types').EntityState> = new Map();
  export let canvasFetchPolicy: CanvasFetchPolicy | undefined = undefined;

  /** Hard cap on a single response body forwarded to the iframe. RSS feeds
   *  are usually a few hundred KB; this cap protects the kiosk from a hostile
   *  or runaway endpoint streaming megabytes. Mirrors the spirit of HA's
   *  template-render limits. */
  const MAX_FETCH_BYTES = 2_000_000;
  /** Hard cap on a single fetch's wall-clock time. Long enough for a slow
   *  feed; short enough to recover from a hung server. */
  const FETCH_TIMEOUT_MS = 15_000;

  $: data = (widget.data as CanvasData | null) ?? { resolved: '', liveEntityIds: [] };
  $: content = data.resolved;

  let iframeEl: HTMLIFrameElement;
  let wrapperEl: HTMLDivElement;
  let resizeObs: ResizeObserver | null = null;
  let lastEntityById = new Map<string, EntityState>();
  let extraSubscribed = new Set<string>();
  let hasReportedColors = false;
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
    const rawFamily = scene.typography?.font_family || 'system-ui';
    const fontFamily = /[\s",]/.test(rawFamily) ? rawFamily : `"${rawFamily}", system-ui`;
    const fontScale = typeof scene.typography?.font_scale === 'number' && scene.typography.font_scale > 0
      ? scene.typography.font_scale
      : 1;
    const bg = scene.background.type === 'solid'
      ? scene.background.color
      : (scene.background.colors?.[0] ?? '');
    // Foreground (text) color — same priority as SceneCanvas:
    //   typography.color > auto-contrast pick > kiosk default (#f5f5f5).
    // Canvases that opt in via `color: var(--cosmos-fg)` (or use the bridge's
    // body default) match the rest of the scene automatically.
    const explicit =
      typeof scene.typography?.color === 'string' && scene.typography.color.trim() !== ''
        ? scene.typography.color
        : null;
    const fg = explicit
      ?? (scene.background.auto_contrast === true ? pickContrastColor(scene.background) : '#f5f5f5');
    return {
      size: { w, h },
      scene: { id: scene.id, name: scene.name },
      font: { family: fontFamily, scale: fontScale },
      tokens: { bg, fg },
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
    if (msg.type === 'cosmos:fetch') {
      void handleBridgeFetch(msg as BridgeFetchRequest);
    }
    if (msg.type === 'cosmos:report-colors') {
      const raw = (msg as { colors?: unknown }).colors;
      if (!Array.isArray(raw)) return;
      const colors: string[] = [];
      for (const c of raw) {
        if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) colors.push(c.toLowerCase());
        if (colors.length >= 5) break;
      }
      if (colors.length > 0) {
        hasReportedColors = true;
      } else {
        hasReportedColors = false;
      }
      reportWidgetPalette(widget.id, colors);
      return;
    }
  }

  type BridgeFetchRequest = {
    type: 'cosmos:fetch';
    id: number;
    url: string;
    init: { method?: string; headers?: Record<string, string>; body?: string } | null;
  };

  function postFetchResult(id: number, result: Record<string, unknown>) {
    iframeEl?.contentWindow?.postMessage({ type: 'cosmos:fetch:result', id, ...result }, '*');
  }

  async function handleBridgeFetch(req: BridgeFetchRequest) {
    const id = req.id;
    let parsed: URL;
    try {
      parsed = new URL(req.url);
    } catch {
      postFetchResult(id, { error: 'cosmos.fetch: invalid URL' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      postFetchResult(id, { error: 'cosmos.fetch: only http(s) URLs are allowed' });
      return;
    }
    if (!isHostAllowed(parsed.hostname, canvasFetchPolicy)) {
      const mode = canvasFetchPolicy?.mode ?? 'off';
      postFetchResult(id, {
        error:
          mode === 'off'
            ? 'cosmos.fetch is disabled. Enable it under Admin → Settings → Canvas fetch.'
            : `cosmos.fetch: host "${parsed.hostname}" is not on the allowlist.`,
      });
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const init: RequestInit = {
        method: req.init?.method || 'GET',
        headers: req.init?.headers || {},
        body: req.init?.body,
        // Never send credentials, never follow redirects to a different
        // origin without re-checking the allowlist (browser will follow
        // by default; we redo the host check on the response URL below).
        credentials: 'omit',
        mode: 'cors',
        redirect: 'follow',
        signal: controller.signal,
      };
      const res = await fetch(parsed.toString(), init);
      // Re-check the post-redirect host before forwarding the body.
      try {
        const finalHost = new URL(res.url || parsed.toString()).hostname;
        if (!isHostAllowed(finalHost, canvasFetchPolicy)) {
          postFetchResult(id, { error: `cosmos.fetch: redirected to "${finalHost}" which is not on the allowlist.` });
          return;
        }
      } catch {
        // If we can't parse res.url, fall through with the original parsed host.
      }

      // Cap the body. Reading as text first lets us honor the cap before
      // the iframe sees anything; we always serialize as text and let the
      // iframe call .json() if it wants JSON.
      const text = await res.text();
      if (text.length > MAX_FETCH_BYTES) {
        postFetchResult(id, { error: `cosmos.fetch: response exceeded ${MAX_FETCH_BYTES} bytes` });
        return;
      }
      const headersOut: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headersOut[k.toLowerCase()] = v;
      });
      postFetchResult(id, {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: res.url,
        headers: headersOut,
        body: text,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'fetch failed';
      postFetchResult(id, { error: `cosmos.fetch: ${reason}` });
    } finally {
      window.clearTimeout(timer);
    }
  }

  $: if (iframeEl && data.liveEntityIds) {
    for (const id of data.liveEntityIds) {
      const e = entitiesById.get(id);
      if (!e) continue;
      const prev = lastEntityById.get(id);
      if (!prev || prev.state !== e.state || JSON.stringify(prev.attributes) !== JSON.stringify(e.attributes)) {
        forwardEntity(e);
      }
    }
  }

  export function forwardEntity(entity: EntityState) {
    lastEntityById.set(entity.entity_id, entity);
    postState(entity);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('message', onMessage);
  }

  $: sceneSig = JSON.stringify({
    f: scene.typography?.font_family,
    s: scene.typography?.font_scale,
    c: scene.typography?.color,
    b: scene.background,
    n: scene.name,
  });
  $: if (iframeEl && sceneSig) postContext();

  onMount(() => {
    resizeObs = new ResizeObserver(() => postContext());
    if (wrapperEl) resizeObs.observe(wrapperEl);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', onMessage);
    }
    resizeObs?.disconnect();
    if (hasReportedColors) reportWidgetPalette(widget.id, []);
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
