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

/** Rotation intervals, in minutes. 0 = advance when the clip ends. */
export const AERIAL_INTERVALS_MIN = [0, 5, 15, 30, 60, 120, 240] as const;

/** One resolved clip as shipped to the kiosk. */
export type AerialClip = { id: string; name: string; url: string };

/** The aerials half of a MoodConfig: which clips, and how they rotate. */
export type AerialMoodConfig = {
  /** Individually picked Apple aerial ids, in the user's order. */
  ids: string[];
  /** Whole types ("all Landscape"); clips Apple adds later join automatically. */
  categories?: AerialCategory[];
  /** Default false = play in `ids` order. */
  shuffle?: boolean;
  /** One of AERIAL_INTERVALS_MIN. Default 30. */
  interval_min?: number;
};

export type AerialCatalog = {
  fetchedAt: number;
  /** Which feed URL produced this catalog. */
  source: string;
  assets: AerialAsset[];
};
