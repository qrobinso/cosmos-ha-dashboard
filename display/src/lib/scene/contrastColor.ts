import type { Background } from '$lib/types';

/** Parse a 3- or 6-digit hex color into normalized 0..1 sRGB channels.
 *  Returns null for unrecognised inputs (caller treats as "skip"). */
function parseHex(input: string): [number, number, number] | null {
  const s = input.trim().replace(/^#/, '');
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r / 255, g / 255, b / 255];
  }
  if (s.length === 6) {
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r / 255, g / 255, b / 255];
  }
  return null;
}

/** W3C relative luminance (sRGB → linear → weighted). Returns 0..1. */
function relativeLuminance(rgb: [number, number, number]): number {
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Pick a high-contrast text color (near-black or near-white) for the given
 *  background, using the WCAG luminance threshold (0.179) above which black
 *  text wins. For gradients, averages the luminance of all stops so the choice
 *  is stable across the animation rather than flickering on each color stop. */
export function pickContrastColor(background: Background): string {
  const colors = background.type === 'solid' ? [background.color] : background.colors;
  const lums = colors.map(parseHex).filter((c): c is [number, number, number] => c !== null).map(relativeLuminance);
  if (lums.length === 0) return '#f5f5f5'; // matches the kiosk default
  const avg = lums.reduce((a, b) => a + b, 0) / lums.length;
  // Threshold derived from WCAG: above ~0.179, black text yields better contrast
  // than white. Using 0.5 instead would bias toward white on borderline-mid
  // tones, which is exactly the failure mode that motivated this code.
  return avg > 0.179 ? '#0a0a0a' : '#f5f5f5';
}
