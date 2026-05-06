import type { TemplatesClient } from '../ha/templates.js';

export type CanvasResolver = (widgetId: string, content: string) => Promise<{
  resolved: string;
  entityIds: string[];
}>;

/**
 * Builds a resolver function that the assembler calls for every canvas
 * widget on every scene assemble. Maintains a per-widget cleanup map so
 * re-resolving a widget (after a content edit) drops the previous HA
 * subscription before registering the new one.
 *
 * `onUpdate(widgetId)` fires whenever any of widget `widgetId`'s templates
 * re-renders (i.e., an entity it depends on changed). The host wires this
 * to the existing `markDisplayDirty` machinery so the scene re-pushes.
 */
export function createCanvasResolver(
  templates: TemplatesClient | null,
  onUpdate: (widgetId: string) => void,
): CanvasResolver & { dispose(widgetId?: string): void } {
  const cleanups = new Map<string, () => void>();

  const resolver: CanvasResolver = async (widgetId, content) => {
    // Drop any previous subscription for this widget.
    cleanups.get(widgetId)?.();
    cleanups.delete(widgetId);

    if (!templates || !content) {
      return { resolved: content, entityIds: [] };
    }

    const r = await templates.render(content, () => {
      onUpdate(widgetId);
    });
    cleanups.set(widgetId, r.unsubscribe);
    return { resolved: r.initial, entityIds: r.entityIds };
  };

  return Object.assign(resolver, {
    dispose(widgetId?: string) {
      if (widgetId === undefined) {
        for (const c of cleanups.values()) c();
        cleanups.clear();
        return;
      }
      cleanups.get(widgetId)?.();
      cleanups.delete(widgetId);
    },
  });
}
