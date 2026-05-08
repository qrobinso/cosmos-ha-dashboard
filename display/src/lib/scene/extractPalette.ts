/** Extract up to 5 dominant `#rrggbb` colors from an image. Pure browser
 *  code: paints to a 64×64 offscreen canvas, samples pixels, bins into a
 *  5×5×5 RGB histogram, drops near-greyscale buckets, returns the top
 *  buckets sorted by population.
 *
 *  Used by widget renderers (e.g. MediaPlayer.svelte for album art) to
 *  produce a palette that's then forwarded to the server via
 *  `reportWidgetPalette`. */

const SAMPLE_SIZE = 64;
const BINS_PER_AXIS = 5;
const SATURATION_FLOOR = 0.18; // skip greys

export function extractFromImage(img: HTMLImageElement): string[] {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    // CORS-tainted canvas — bail. Caller must use crossorigin="anonymous".
    return [];
  }
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue; // skip transparent
    if (isGrey(r, g, b)) continue;
    const key = bin(r) * BINS_PER_AXIS * BINS_PER_AXIS + bin(g) * BINS_PER_AXIS + bin(b);
    const e = buckets.get(key);
    if (e) {
      e.count++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((e) => toHex(e.r / e.count, e.g / e.count, e.b / e.count));
}

export async function extractFromUrl(url: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  return await new Promise<string[]>((resolve) => {
    img.onload = () => resolve(extractFromImage(img));
    img.onerror = () => resolve([]);
    img.src = url;
  });
}

function bin(v: number): number {
  return Math.min(BINS_PER_AXIS - 1, Math.floor((v / 256) * BINS_PER_AXIS));
}

function isGrey(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return true;
  return (max - min) / max < SATURATION_FLOOR;
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
