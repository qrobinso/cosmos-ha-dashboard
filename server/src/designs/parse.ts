import { load as loadYaml, YAMLException } from 'js-yaml';

export type ParsedDesignPack = {
  /** YAML frontmatter object. `{}` when missing or unparseable. */
  frontmatter: Record<string, unknown>;
  /** Raw markdown body (everything after the closing `---`, or the whole
   *  file if there's no frontmatter block). */
  body: string;
  /** Non-fatal warnings — YAML parse errors land here so the API can still
   *  return the body but the caller knows the frontmatter was dropped. */
  errors: string[];
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?([\s\S]*)$/;

export function parseDesignPack(raw: string): ParsedDesignPack {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) {
    return { frontmatter: {}, body: raw, errors: [] };
  }
  const [, yamlBlock, body] = m;
  try {
    const parsed = loadYaml(yamlBlock);
    if (parsed === undefined || parsed === null) {
      return { frontmatter: {}, body, errors: [] };
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { frontmatter: {}, body, errors: ['frontmatter must be a YAML object'] };
    }
    return { frontmatter: parsed as Record<string, unknown>, body, errors: [] };
  } catch (err) {
    const msg = err instanceof YAMLException ? `yaml: ${err.message}` : 'yaml: parse failed';
    return { frontmatter: {}, body, errors: [msg] };
  }
}

/** Project a parsed frontmatter into the small shape the admin dropdown
 *  + MCP `list_designs` uses for previews. Returns the first 4 hex values
 *  encountered in `colors` (depth-1) and `typography.body.fontFamily` if
 *  present. Designed to be tolerant: any missing piece resolves to a safe
 *  default rather than an error. */
export function previewFromFrontmatter(
  fm: Record<string, unknown>
): { colors: string[]; font_family: string | null } {
  const colors: string[] = [];
  const fmColors = fm.colors;
  if (fmColors && typeof fmColors === 'object' && !Array.isArray(fmColors)) {
    for (const v of Object.values(fmColors as Record<string, unknown>)) {
      if (typeof v === 'string' && /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim())) {
        colors.push(v.trim());
        if (colors.length === 4) break;
      }
    }
  }
  let font_family: string | null = null;
  const typo = fm.typography;
  if (typo && typeof typo === 'object' && !Array.isArray(typo)) {
    const body = (typo as Record<string, unknown>).body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const ff = (body as Record<string, unknown>).fontFamily;
      if (typeof ff === 'string' && ff.trim() !== '') font_family = ff.trim();
    }
  }
  return { colors, font_family };
}
