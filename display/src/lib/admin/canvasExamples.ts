export type CanvasExample = { id: string; label: string; description: string; content: string };

export const CANVAS_EXAMPLES: CanvasExample[] = [
  {
    id: 'hello',
    label: 'Hello world',
    description: 'Static text + a live read of the canvas size.',
    content: `<div style="display:grid;place-items:center;width:100%;height:100%;font-family:system-ui;color:var(--cosmos-fg,#f5f5f5)">
  <div>
    <h1 style="margin:0;font-weight:300">Hello, canvas!</h1>
    <p id="size" style="margin:0.5rem 0 0;opacity:0.6"></p>
  </div>
</div>
<script>
  cosmos.ready.then(() => {
    document.getElementById('size').textContent = cosmos.size.w + ' × ' + cosmos.size.h + ' px';
  });
  window.addEventListener('cosmos:resize', () => {
    document.getElementById('size').textContent = cosmos.size.w + ' × ' + cosmos.size.h + ' px';
  });
</script>`,
  },
  {
    id: 'entity-card',
    label: 'Templated entity card',
    description: 'One Jinja template + a styled box. No JS.',
    content: `<div style="padding:1.5rem;font-family:system-ui;color:var(--cosmos-fg,#f5f5f5)">
  <div style="opacity:0.6;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em">Power</div>
  <div style="font-size:3rem;font-weight:200;line-height:1.1">{{ states("sensor.power") }} W</div>
  <div style="opacity:0.6;font-size:0.85rem">last updated {{ relative_time(states.sensor.power.last_changed) }}</div>
</div>`,
  },
  {
    id: 'live-gauge',
    label: 'Live gauge',
    description: 'Subscribe to a sensor and animate an SVG arc.',
    content: `<div style="display:grid;place-items:center;width:100%;height:100%">
  <svg viewBox="0 0 100 60" width="80%" style="overflow:visible">
    <path d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="6" stroke-linecap="round"/>
    <path id="fill" d="M10,50 A40,40 0 0,1 90,50" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-dasharray="0 200"/>
    <text id="lbl" x="50" y="50" text-anchor="middle" fill="#fff" font-family="system-ui" font-size="12">—</text>
  </svg>
</div>
<script>
  cosmos.subscribe('sensor.power', (e) => {
    const v = Math.max(0, Math.min(2000, Number(e.state) || 0));
    const pct = v / 2000;
    document.getElementById('fill').setAttribute('stroke-dasharray', (pct * 126) + ' 200');
    document.getElementById('lbl').textContent = Math.round(v) + ' W';
  });
</script>`,
  },
  {
    id: 'recipe',
    label: 'Recipe card',
    description: 'Static HTML — no templates, no JS.',
    content: `<div style="display:grid;grid-template-rows:auto 1fr;width:100%;height:100%;font-family:system-ui;color:var(--cosmos-fg,#f5f5f5);padding:1rem">
  <h2 style="margin:0;font-weight:300">Tonight: shakshuka</h2>
  <ol style="margin:0.5rem 0 0;padding-left:1.25rem;line-height:1.5;opacity:0.85">
    <li>Sauté onion + pepper in olive oil 8 min</li>
    <li>Add garlic, cumin, paprika; stir 30s</li>
    <li>Pour in crushed tomatoes; simmer 15 min</li>
    <li>Crack 4 eggs into wells; cover 6 min</li>
    <li>Top with feta and parsley; serve with bread</li>
  </ol>
</div>`,
  },
  {
    id: 'sun-palette',
    label: 'Sun-driven palette',
    description: 'Subscribes to sun.sun and swaps CSS variables to match dawn/day/dusk/night.',
    content: `<div id="root" style="--bg:#1a1a2e;--fg:#f5f5f5;background:var(--bg);color:var(--fg);width:100%;height:100%;display:grid;place-items:center;transition:background 1s,color 1s;font-family:system-ui">
  <div style="text-align:center">
    <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.15em;opacity:0.6">Sun phase</div>
    <div id="phase" style="font-size:2rem;font-weight:300">—</div>
  </div>
</div>
<script>
  function paint(state) {
    const root = document.getElementById('root');
    if (state === 'above_horizon') {
      root.style.setProperty('--bg', '#fcb69f');
      root.style.setProperty('--fg', '#3a1c00');
      document.getElementById('phase').textContent = 'Day';
    } else {
      root.style.setProperty('--bg', '#1a1a2e');
      root.style.setProperty('--fg', '#bfe9ff');
      document.getElementById('phase').textContent = 'Night';
    }
  }
  cosmos.subscribe('sun.sun', (e) => paint(e.state));
</script>`,
  },
];
