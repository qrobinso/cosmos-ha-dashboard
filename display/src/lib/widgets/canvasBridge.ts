/** The bridge script string injected into every canvas iframe's `srcdoc`.
 *  Runs inside the iframe with origin `null`. Communicates with the parent
 *  via `postMessage`. Read-only — no service calls, no mutation. */
export const CANVAS_BRIDGE_SCRIPT = `
<script>
(function () {
  var COSMOS_VERSION = '1.0.0';
  var entitiesById = {};
  var subscribers = {};
  var resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });
  var initReceived = false;
  var readyInterval = null;

  var cosmos = {
    size: { w: 0, h: 0 },
    scene: { id: '', name: '' },
    font: { family: 'system-ui', scale: 1 },
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
  };
  window.cosmos = cosmos;

  function applyContext(ctx) {
    if (ctx.size) { cosmos.size.w = ctx.size.w; cosmos.size.h = ctx.size.h; }
    if (ctx.scene) { cosmos.scene.id = ctx.scene.id; cosmos.scene.name = ctx.scene.name; }
    if (ctx.font) { cosmos.font.family = ctx.font.family; cosmos.font.scale = ctx.font.scale; }
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
    }
  });

  function emitReady() {
    try { window.parent.postMessage({ type: 'cosmos:ready' }, '*'); } catch (e) {}
  }
  emitReady();
  readyInterval = setInterval(function () {
    if (initReceived) {
      if (readyInterval) { clearInterval(readyInterval); readyInterval = null; }
      return;
    }
    emitReady();
  }, 200);
})();
</script>
`;
