/** The four types Apple groups its aerials into. Stable across tvOS 16 → 26. */
export type AerialCategory = 'earth' | 'landscape' | 'city' | 'sea';

export const AERIAL_CATEGORIES: readonly AerialCategory[] = ['earth', 'landscape', 'city', 'sea'];

export const AERIAL_CATEGORY_LABELS: Record<AerialCategory, string> = {
  earth: 'Earth',
  landscape: 'Landscape',
  city: 'Cityscape',
  sea: 'Underwater',
};

/** One playable clip, already reduced to what the kiosk and editor need. */
export type AerialAsset = {
  id: string;
  /** Apple's English label, numbered when a location has several shots. */
  name: string;
  category: AerialCategory;
  subcategory?: string;
  /** Apple-hosted 900x580 PNG; the admin loads it directly (CORS is open). */
  previewUrl: string;
  /** The 1080p H.264 variant — the only one a Chromium kiosk can decode. */
  sourceUrl: string;
};

export type AerialCatalog = {
  fetchedAt: number;
  /** Which feed URL produced this catalog. */
  source: string;
  assets: AerialAsset[];
};
