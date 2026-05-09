/** The bridge script string injected into every canvas iframe's `srcdoc`.
 *  Runs inside the iframe with origin `null`. Communicates with the parent
 *  via `postMessage`. Read-only — no service calls, no mutation. */
export const CANVAS_BRIDGE_SCRIPT = `
<style>
  html, body { width: 100%; height: 100%; margin: 0; padding: 0; box-sizing: border-box; }
  *, *::before, *::after { box-sizing: inherit; }
  /* Default text color follows the scene's resolved foreground (typography.color
     override > auto-contrast pick > kiosk default). Canvases that set their own
     'color' inline still win; this is just the inherited fallback. */
  body { color: var(--cosmos-fg, #f5f5f5); }
</style>
<script>
(function () {
  var COSMOS_VERSION = '1.0.0';
  var entitiesById = {};
  var subscribers = {};
  var resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });
  var initReceived = false;
  var readyInterval = null;

  var fetchSeq = 0;
  var fetchPending = {};

  var cosmos = {
    size: { w: 0, h: 0 },
    scene: { id: '', name: '' },
    font: { family: 'system-ui', scale: 1 },
    tokens: { bg: '', fg: '' },
    version: COSMOS_VERSION,
    ready: ready,
    entity: function (id) { return entitiesById[id] || null; },
    subscribe: function (id, cb) {
      var list = subscribers[id] || (subscribers[id] = []);
      list.push(cb);
      if (entitiesById[id]) cb(entitiesById[id]);
      else {
        try { window.parent.postMessage({ type: 'cosmos:want-entity', entity_ids: [id] }, '*'); } catch (e) {}
      }
      return function () {
        var i = (subscribers[id] || []).indexOf(cb);
        if (i >= 0) subscribers[id].splice(i, 1);
      };
    },
    /** Bridge fetch — the parent does the actual request on this iframe's
     *  behalf, gated by the per-server allowlist. Resolves with a small
     *  Response-shaped object: { ok, status, statusText, url, headers, text(),
     *  json() }. Rejects on network errors, allowlist denial, timeouts, or
     *  oversized responses (parent caps body size). */
    fetch: function (url, init) {
      var id = ++fetchSeq;
      return new Promise(function (resolve, reject) {
        fetchPending[id] = { resolve: resolve, reject: reject };
        // Only forward fields we explicitly support. The parent strips
        // anything else; spelling them out here gives the agent a clear
        // contract and avoids serialization surprises (e.g. Headers / Blob).
        var safeInit = null;
        if (init && typeof init === 'object') {
          safeInit = {};
          if (typeof init.method === 'string') safeInit.method = init.method;
          if (init.headers && typeof init.headers === 'object') safeInit.headers = init.headers;
          if (typeof init.body === 'string') safeInit.body = init.body;
        }
        try {
          window.parent.postMessage(
            { type: 'cosmos:fetch', id: id, url: String(url), init: safeInit },
            '*'
          );
        } catch (e) {
          delete fetchPending[id];
          reject(new Error('cosmos.fetch: parent unreachable'));
        }
      });
    },
    /** Report this canvas's dominant colors back to Cosmos. Feeds the
     *  scene's adaptive gradient when the user has enabled it. Pass an
     *  empty array to clear. Caller can call as often as it likes; the
     *  parent dedupes via the server-side change detector. */
    reportColors: function (colors) {
      if (!Array.isArray(colors)) return;
      try {
        window.parent.postMessage({ type: 'cosmos:report-colors', colors: colors }, '*');
      } catch (e) {}
    },
  };
  window.cosmos = cosmos;

  function applyContext(ctx) {
    if (ctx.size) { cosmos.size.w = ctx.size.w; cosmos.size.h = ctx.size.h; }
    if (ctx.scene) { cosmos.scene.id = ctx.scene.id; cosmos.scene.name = ctx.scene.name; }
    if (ctx.font) { cosmos.font.family = ctx.font.family; cosmos.font.scale = ctx.font.scale; }
    if (ctx.tokens) {
      cosmos.tokens.bg = ctx.tokens.bg || '';
      cosmos.tokens.fg = ctx.tokens.fg || '';
    }
    applyCssVars();
  }

  function applyCssVars() {
    var root = document.documentElement && document.documentElement.style;
    if (!root) return;
    root.setProperty('--cosmos-font-family', cosmos.font.family);
    root.setProperty('--cosmos-font-scale', String(cosmos.font.scale));
    root.setProperty('--cosmos-w', cosmos.size.w + 'px');
    root.setProperty('--cosmos-h', cosmos.size.h + 'px');
    root.setProperty('--cosmos-bg', cosmos.tokens.bg);
    root.setProperty('--cosmos-fg', cosmos.tokens.fg);
    root.setProperty('--cosmos-scene-id', cosmos.scene.id);
    root.setProperty('--cosmos-scene-name', cosmos.scene.name);
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var msg = ev.data;
    if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('cosmos:') !== 0) return;
    if (msg.type === 'cosmos:init') {
      initReceived = true;
      if (readyInterval) { clearInterval(readyInterval); readyInterval = null; }
      applyContext(msg.context || {});
      var list = msg.entities || [];
      for (var i = 0; i < list.length; i++) entitiesById[list[i].entity_id] = list[i];
      resolveReady && resolveReady();
    } else if (msg.type === 'cosmos:state') {
      var e = msg.entity;
      if (!e || typeof e.entity_id !== 'string') return;
      entitiesById[e.entity_id] = e;
      var subs = subscribers[e.entity_id] || [];
      for (var j = 0; j < subs.length; j++) {
        try { subs[j](e); } catch (err) { /* iframe author bug; swallow */ }
      }
    } else if (msg.type === 'cosmos:context') {
      applyContext(msg.context || {});
      try { window.dispatchEvent(new CustomEvent('cosmos:resize')); } catch (e) {}
    } else if (msg.type === 'cosmos:fetch:result') {
      var pending = fetchPending[msg.id];
      if (!pending) return;
      delete fetchPending[msg.id];
      if (msg.error) {
        pending.reject(new Error(msg.error));
        return;
      }
      var bodyText = typeof msg.body === 'string' ? msg.body : '';
      pending.resolve({
        ok: !!msg.ok,
        status: msg.status || 0,
        statusText: msg.statusText || '',
        url: msg.url || '',
        headers: msg.headers || {},
        text: function () { return Promise.resolve(bodyText); },
        json: function () {
          try { return Promise.resolve(JSON.parse(bodyText)); }
          catch (e) { return Promise.reject(e); }
        },
      });
    }
  });

  function emitReady() {
    try { window.parent.postMessage({ type: 'cosmos:ready' }, '*'); } catch (e) {}
  }
  emitReady();
  // Hard-cap the ready-emission loop. If the parent never responds (e.g. the
  // iframe is being torn down mid-handshake during a rapid scene swap), the
  // interval would otherwise keep firing in the detached iframe context until
  // GC catches it — adding a few stray ticks per leaked iframe over time.
  // 25 attempts * 200ms = 5s; if init hasn't arrived by then, it's not coming.
  var readyAttempts = 0;
  readyInterval = setInterval(function () {
    if (initReceived || readyAttempts >= 25) {
      if (readyInterval) { clearInterval(readyInterval); readyInterval = null; }
      return;
    }
    readyAttempts++;
    emitReady();
  }, 200);
})();
</script>
`;
