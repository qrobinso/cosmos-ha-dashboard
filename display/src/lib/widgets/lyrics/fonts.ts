import { hash } from './poster';

/** One typeface as the lyrics widget uses it. Fonts are bundled via @fontsource (fonts.css). */
export type Face = {
  family: string;
  weight: number;
  italic?: boolean;
  upper?: boolean;
  /** Degrees; handwritten faces read more alive slightly off-axis. */
  tilt?: number;
  /** Size multiplier evening out optical size (condensed caps vs. wide blacks). */
  scale?: number;
  /** Ornamental faces (Monoton) are only legible on short words. */
  shortOnly?: boolean;
};

const SHORT_LEN = 8;

const PLAYFAIR: Face = { family: 'Playfair Display', weight: 900 };
const CORMORANT: Face = { family: 'Cormorant Garamond', weight: 300, italic: true, scale: 1.15 };
const INTER_HAIR: Face = { family: 'Inter', weight: 200, upper: true, scale: 0.7 };
const BEBAS: Face = { family: 'Bebas Neue', weight: 400, upper: true, scale: 1.25 };
const ARCHIVO: Face = { family: 'Archivo Black', weight: 400, upper: true, scale: 0.82 };
const MARKER: Face = { family: 'Permanent Marker', weight: 400, tilt: -3, scale: 0.9 };
const CAVEAT: Face = { family: 'Caveat', weight: 700, tilt: -2, scale: 1.3 };
const ABRIL: Face = { family: 'Abril Fatface', weight: 400 };
const MONOTON: Face = { family: 'Monoton', weight: 400, upper: true, scale: 0.9, shortOnly: true };
const SYNE: Face = { family: 'Syne', weight: 800, scale: 0.85 };
const MAJOR_MONO: Face = { family: 'Major Mono Display', weight: 400, scale: 0.6 };

/** The first face of each mood is its main font (Spotlight, Karaoke). */
export const FONT_MOODS = {
  editorial: [PLAYFAIR, CORMORANT, INTER_HAIR],
  gig: [BEBAS, ARCHIVO, MARKER],
  handwritten: [CAVEAT, MARKER],
  retro: [ABRIL, SYNE, MONOTON],
  mixtape: [ARCHIVO, PLAYFAIR, CORMORANT, INTER_HAIR, BEBAS, MARKER, CAVEAT, ABRIL, SYNE, MONOTON, MAJOR_MONO],
} satisfies Record<string, Face[]>;

export type FontMood = keyof typeof FONT_MOODS;

/** null = use the scene's font (the default). */
export function moodFaces(mood: unknown): Face[] | null {
  return typeof mood === 'string' && mood in FONT_MOODS ? FONT_MOODS[mood as FontMood] : null;
}

/** Deterministic per seed, so a repeated line always gets the same face. */
export function pickFace(faces: Face[], seed: string, textLen: number): Face {
  const usable = textLen > SHORT_LEN ? faces.filter((f) => !f.shortOnly) : faces;
  return usable[hash(seed) % usable.length];
}

export function faceCss(f: Face): string {
  return [
    `font-family: '${f.family}', var(--cosmos-font-Inter)`,
    `font-weight: ${f.weight}`,
    f.italic ? 'font-style: italic' : '',
    f.upper ? 'text-transform: uppercase' : '',
    // `rotate`, not `transform`: Drift's keyframes animate transform and would cancel it.
    f.tilt ? `rotate: ${f.tilt}deg` : '',
  ]
    .filter(Boolean)
    .join('; ');
}
