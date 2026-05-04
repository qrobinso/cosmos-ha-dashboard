<script lang="ts">
  import type { WidgetState, StatisticsData, StatisticsPoint } from '$lib/types';

  export let widget: WidgetState;

  $: data = widget.data as StatisticsData | null;
  $: cfg = widget.config as Record<string, unknown>;

  $: showCurrent = cfg.show_current !== false;
  $: showMinMax = cfg.show_min_max !== false;
  $: showUnit = cfg.show_unit !== false;
  $: showAxis = cfg.show_axis === true;
  $: showAreaFill = cfg.show_area_fill !== false;
  $: smoothing = cfg.smoothing !== false;
  $: chartType = (cfg.chart_type === 'bar' ? 'bar' : 'line') as 'line' | 'bar';
  $: title = typeof cfg.title === 'string' && cfg.title ? cfg.title : data?.friendly_name ?? 'Statistic';
  $: color = (typeof cfg.color === 'string' && cfg.color) ? cfg.color : 'currentColor';

  // Build the SVG path for the line/area, normalised into a 100x100 viewBox.
  function buildPath(points: StatisticsPoint[], min: number, max: number, smooth: boolean): { line: string; area: string } {
    if (points.length === 0) return { line: '', area: '' };
    if (points.length === 1) {
      const x = 50;
      const y = 50;
      return { line: `M ${x} ${y}`, area: `M 0 100 L ${x} ${y} L 100 100 Z` };
    }
    const range = Math.max(0.0001, max - min);
    const x = (i: number) => (i / (points.length - 1)) * 100;
    const y = (v: number) => 100 - ((v - min) / range) * 100;

    if (!smooth) {
      let line = `M ${x(0)} ${y(points[0].v)}`;
      for (let i = 1; i < points.length; i++) line += ` L ${x(i)} ${y(points[i].v)}`;
      const area = `${line} L 100 100 L 0 100 Z`;
      return { line, area };
    }

    // Catmull-Rom-ish smoothing: control points are 1/6 of the segment length.
    let line = `M ${x(0)} ${y(points[0].v)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const cp1x = x(i) + (x(i + 1) - x(i - 1 < 0 ? 0 : i - 1)) / 6;
      const cp1y = y(p1.v) + (y(p2.v) - y(p0.v)) / 6;
      const cp2x = x(i + 1) - (x(i + 2 >= points.length ? points.length - 1 : i + 2) - x(i)) / 6;
      const cp2y = y(p2.v) - (y(p3.v) - y(p1.v)) / 6;
      line += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${x(i + 1).toFixed(2)} ${y(p2.v).toFixed(2)}`;
    }
    const area = `${line} L 100 100 L 0 100 Z`;
    return { line, area };
  }

  $: chart = (() => {
    if (!data || data.points.length === 0) return null;
    const lo = data.min ?? Math.min(...data.points.map((p) => p.v));
    const hi = data.max ?? Math.max(...data.points.map((p) => p.v));
    return { ...buildPath(data.points, lo, hi, smoothing), lo, hi };
  })();

  $: bars = (() => {
    if (chartType !== 'bar' || !data || data.points.length === 0) return [];
    const lo = data.min ?? Math.min(...data.points.map((p) => p.v));
    const hi = data.max ?? Math.max(...data.points.map((p) => p.v));
    const range = Math.max(0.0001, hi - lo);
    const w = 100 / data.points.length;
    return data.points.map((p, i) => ({
      x: i * w + w * 0.1,
      y: 100 - ((p.v - lo) / range) * 100,
      width: w * 0.8,
      height: ((p.v - lo) / range) * 100,
    }));
  })();

  function fmt(v: number | undefined): string {
    if (v === undefined) return '–';
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }
</script>

<div class="stat" style="--stat-color: {color}">
  <header>
    <span class="title">{title}</span>
    {#if showCurrent}
      <span class="current">
        <span class="value">{fmt(data?.current)}</span>
        {#if showUnit && data?.unit}<span class="unit">{data.unit}</span>{/if}
      </span>
    {/if}
  </header>

  <div class="chart-wrap">
    <svg
      class="chart"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${title} sparkline`}
    >
      {#if showAxis}
        <line x1="0" y1="0" x2="0" y2="100" class="axis" />
        <line x1="0" y1="100" x2="100" y2="100" class="axis" />
      {/if}
      {#if chartType === 'line' && chart}
        {#if showAreaFill}
          <path d={chart.area} class="area" />
        {/if}
        <path d={chart.line} class="line" />
      {:else if chartType === 'bar'}
        {#each bars as b, i (i)}
          <rect class="bar" x={b.x} y={b.y} width={b.width} height={b.height} />
        {/each}
      {/if}
    </svg>
  </div>

  {#if showMinMax}
    <footer>
      <span class="minmax">low {fmt(data?.min)}{data?.unit ? data.unit : ''}</span>
      <span class="minmax">high {fmt(data?.max)}{data?.unit ? data.unit : ''}</span>
    </footer>
  {/if}
</div>

<style>
  .stat {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 0.85rem;
    box-sizing: border-box;
    color: inherit;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .title {
    font-size: calc(0.85rem * var(--cosmos-font-scale, 1));
    opacity: 0.75;
    text-transform: capitalize;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current { display: inline-flex; align-items: baseline; gap: 0.2rem; }
  .value {
    font-size: calc(1.25rem * var(--cosmos-font-scale, 1));
    font-weight: 600;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }
  .unit {
    font-size: calc(0.78rem * var(--cosmos-font-scale, 1));
    opacity: 0.65;
  }
  .chart-wrap {
    flex: 1;
    min-height: 2.5rem;
    margin: 0.45rem 0;
  }
  .chart {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
  .line {
    fill: none;
    stroke: var(--stat-color);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .area {
    fill: var(--stat-color);
    opacity: 0.18;
  }
  .bar {
    fill: var(--stat-color);
    opacity: 0.85;
  }
  .axis {
    stroke: currentColor;
    stroke-opacity: 0.18;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  footer {
    display: flex;
    justify-content: space-between;
    font-size: calc(0.7rem * var(--cosmos-font-scale, 1));
    opacity: 0.55;
    font-variant-numeric: tabular-nums;
  }
</style>
