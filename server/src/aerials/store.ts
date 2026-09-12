import type { SettingsRepo } from '../store/settings.js';
import type { AerialAsset, AerialCatalog } from './types.js';

/** Settings key holding the last successfully fetched catalog as JSON. */
export const CATALOG_SETTING = 'aerials.catalog';

export type AerialCatalogStore = {
  get(): AerialCatalog | null;
  set(catalog: AerialCatalog): void;
  /** Convenience for the assembler: the clip list, or [] before any fetch. */
  assets(): AerialAsset[];
};

/**
 * The catalog lives in the settings table rather than its own table because
 * it is one opaque document replaced wholesale on refresh; nothing queries
 * inside it. A corrupt row reads as absent so a bad write can never wedge
 * boot — the next refresh simply overwrites it.
 */
export function createAerialCatalogStore(settings: SettingsRepo): AerialCatalogStore {
  function get(): AerialCatalog | null {
    const raw = settings.get(CATALOG_SETTING);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AerialCatalog;
      if (!parsed || !Array.isArray(parsed.assets)) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  return {
    get,
    set(catalog) {
      settings.set(CATALOG_SETTING, JSON.stringify(catalog));
    },
    assets() {
      return get()?.assets ?? [];
    },
  };
}
