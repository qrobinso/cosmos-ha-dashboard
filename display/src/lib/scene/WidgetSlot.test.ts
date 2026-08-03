import { describe, it, expect, afterEach } from 'vitest';
import WidgetSlot from './WidgetSlot.svelte';
import type { WidgetState } from '$lib/types';

/**
 * Widgets have always been allowed to overlap — the grid stacks items sharing
 * cells and the editor has no collision rules — but the order was implicit DOM
 * order with no way to control it. `config.layer` makes it explicit.
 */
function widget(config: Record<string, unknown> = {}): WidgetState {
  return {
    id: 'w1',
    kind: 'musicvideo',
    position: { col: 1, row: 1, w: 2, h: 2 },
    config,
    data: null,
  } as unknown as WidgetState;
}

let host: HTMLDivElement | null = null;
function mount(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  new WidgetSlot({ target: host, props });
  return host.querySelector('.widget-slot') as HTMLElement;
}

afterEach(() => {
  host?.remove();
  host = null;
});

describe('WidgetSlot — layering', () => {
  it('emits no z-index at all by default, preserving DOM-order stacking', () => {
    const el = mount({ widget: widget() });
    expect(el.style.zIndex).toBe('');
  });

  it('sends a widget behind its siblings', () => {
    const el = mount({ widget: widget({ layer: -1 }) });
    expect(el.style.zIndex).toBe('-1');
  });

  it('brings a widget in front of its siblings', () => {
    const el = mount({ widget: widget({ layer: 1 }) });
    expect(el.style.zIndex).toBe('1');
  });

  it('ignores a non-numeric layer rather than emitting garbage CSS', () => {
    const el = mount({ widget: widget({ layer: 'behind' }) });
    expect(el.style.zIndex).toBe('');
  });

  it('truncates a fractional layer', () => {
    const el = mount({ widget: widget({ layer: -1.8 }) });
    expect(el.style.zIndex).toBe('-1');
  });

  it('still places the widget on the grid', () => {
    const el = mount({ widget: widget({ layer: -1 }) });
    expect(el.style.gridColumn).toContain('1');
    expect(el.style.gridRow).toContain('1');
  });
});
