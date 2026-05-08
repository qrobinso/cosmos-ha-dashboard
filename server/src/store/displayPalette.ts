import { reducePalette } from '../scenes/palette.js';

/** Per-server, per-display palette state. Ephemeral runtime state; lives in
 *  process memory like the canvas-extras store. The display posts per-widget
 *  contributions, the server reduces, the assembler reads `getResolved`. */
export type DisplayPaletteStore = {
  /** Replace one widget's contribution. Empty colors clears it. Returns
   *  whether the resolved palette changed (used to gate a scene re-push). */
  set(displayId: string, widgetId: string, colors: string[]): { resolvedChanged: boolean };
  /** Read the most recent resolved palette for a display. Empty when nothing
   *  has been reported. */
  getResolved(displayId: string): { colors: string[]; updatedAt: string | null };
  /** Read raw per-widget contributions for a display. The assembler runs
   *  the reducer at apply time with `gradient.colors` as the fallback so
   *  the resolved palette is padded to the target stop count. */
  getContributions(displayId: string): Map<string, string[]>;
  /** Drop every contribution for a display (called on disconnect). */
  clearDisplay(displayId: string): void;
  /** Drop contributions whose widget id isn't in `keep` (called from the
   *  assembler so removed widgets stop influencing the palette). */
  pruneWidgets(displayId: string, keep: Set<string>): void;
};

type Entry = {
  contributions: Map<string, string[]>;
  resolved: string[];
  updatedAt: string;
};

const TARGET_COUNT = 3;

export function createDisplayPaletteStore(): DisplayPaletteStore {
  const byDisplay = new Map<string, Entry>();

  function recompute(entry: Entry): string[] {
    return reducePalette(entry.contributions, [], TARGET_COUNT);
  }

  return {
    set(displayId, widgetId, colors) {
      let entry = byDisplay.get(displayId);
      if (!entry) {
        entry = { contributions: new Map(), resolved: [], updatedAt: new Date().toISOString() };
        byDisplay.set(displayId, entry);
      }
      if (colors.length === 0) {
        entry.contributions.delete(widgetId);
      } else {
        entry.contributions.set(widgetId, colors);
      }
      const next = recompute(entry);
      const changed =
        next.length !== entry.resolved.length ||
        next.some((c, i) => c !== entry!.resolved[i]);
      if (changed) {
        entry.resolved = next;
        entry.updatedAt = new Date().toISOString();
      }
      return { resolvedChanged: changed };
    },
    getResolved(displayId) {
      const entry = byDisplay.get(displayId);
      if (!entry) return { colors: [], updatedAt: null };
      return { colors: [...entry.resolved], updatedAt: entry.updatedAt };
    },
    getContributions(displayId) {
      const entry = byDisplay.get(displayId);
      if (!entry) return new Map();
      // Defensive copy so callers can't mutate internal state.
      return new Map(entry.contributions);
    },
    clearDisplay(displayId) {
      byDisplay.delete(displayId);
    },
    pruneWidgets(displayId, keep) {
      const entry = byDisplay.get(displayId);
      if (!entry) return;
      let touched = false;
      for (const id of entry.contributions.keys()) {
        if (!keep.has(id)) {
          entry.contributions.delete(id);
          touched = true;
        }
      }
      if (touched) {
        entry.resolved = recompute(entry);
        entry.updatedAt = new Date().toISOString();
      }
    },
  };
}
