/** Build a CSS `font-family` value that points at the bundled
 *  `--cosmos-font-<Name>` custom property for the given family name, followed
 *  by a real sans-serif fallback chain.
 *
 *  The fallback chain after the `var()` matters: the kiosk always sets
 *  `--cosmos-font-<Name>`, but the named scene font (e.g. "Space Grotesk")
 *  may not be loadable in every context (the canvas iframe is sandboxed and
 *  can't pull `@fontsource` files). Without a real sans-serif after the
 *  `var()`, the browser falls through to its ultimate default — Times New
 *  Roman on most platforms — which looks broken next to the rest of the scene.
 *
 *  Returns `null` for an empty / blank input. Pass `fallbackFamily` when the
 *  caller needs a guaranteed value (e.g. the scene-wide default of "Inter").
 *
 *  Single source of truth for the `family.replace(/\s+/g, '')` slug rule and
 *  the fallback chain — used by `SceneCanvas` (scene-wide) and `Clock` (the
 *  per-widget `config.font_family` override). Keep new call sites pointed
 *  here rather than re-deriving the string. */
export function cosmosFontVar(
  family: string | null | undefined,
  fallbackFamily?: string,
): string | null {
  const name =
    typeof family === 'string' && family.trim() !== ''
      ? family.trim()
      : (typeof fallbackFamily === 'string' && fallbackFamily.trim() !== '' ? fallbackFamily.trim() : null);
  if (name === null) return null;
  const slug = name.replace(/\s+/g, '');
  return `var(--cosmos-font-${slug}, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif)`;
}
