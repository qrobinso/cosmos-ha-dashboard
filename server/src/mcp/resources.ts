import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HaClient } from '../ha/types.js';
import type { DesignPacksRepo } from '../store/design-packs.js';
import { renderHaEntitiesDoc } from '../api/docs.js';

export type McpResourceDeps = {
  /** Absolute path to the bundled `docs/` directory (same one docs.ts uses). */
  docsDir: string;
  haClient: HaClient | null;
  designs: DesignPacksRepo;
};

export type McpResourceListEntry = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

export type McpResourceContents = {
  uri: string;
  mimeType: string;
  text: string;
};

const URI_SCENE_AGENT = 'cosmos://docs/scene-agent';
const URI_CANVAS_AGENT = 'cosmos://docs/canvas-widget-agent';
const URI_ENTITIES = 'cosmos://entities';
const URI_DESIGNS_INDEX = 'cosmos://designs';

/** The catalog the MCP server advertises in `resources/list`. */
export function listMcpResources(deps: McpResourceDeps): McpResourceListEntry[] {
  const base: McpResourceListEntry[] = [
    {
      uri: URI_SCENE_AGENT,
      name: 'Scene authoring contract',
      description:
        'JSON schema and best practices for building a Cosmos Scene. Read this before calling create_scene.',
      mimeType: 'text/markdown',
    },
    {
      uri: URI_CANVAS_AGENT,
      name: 'Canvas widget contract',
      description:
        'HTML/CSS/JS rules and the cosmos.* JS bridge for canvas widgets. Read this before generating canvas content.',
      mimeType: 'text/markdown',
    },
    {
      uri: URI_ENTITIES,
      name: 'Live HA entity catalog',
      description:
        "Snapshot of every Home Assistant entity Cosmos has cached, grouped by domain. Use the listed entity_ids verbatim — don't invent ones.",
      mimeType: 'text/markdown',
    },
    {
      uri: URI_DESIGNS_INDEX,
      name: 'Design pack index',
      description:
        'Index of all DESIGN.md-spec design packs available on this Cosmos. Each entry lists slug, name, and source (built-in or user).',
      mimeType: 'text/markdown',
    },
  ];
  for (const p of deps.designs.list()) {
    base.push({
      uri: `cosmos://designs/${p.slug}`,
      name: `Design pack — ${p.name}`,
      description: `${p.source === 'builtin' ? 'Built-in' : 'User-authored'} design pack. DESIGN.md format (frontmatter + body).`,
      mimeType: 'text/markdown',
    });
  }
  return base;
}

/** Cache the two file-backed contracts since they don't change at runtime. */
const cache = { sceneAgent: null as string | null, canvasAgent: null as string | null };

async function readContract(docsDir: string, slug: string, key: 'sceneAgent' | 'canvasAgent'): Promise<string> {
  if (cache[key] !== null) return cache[key]!;
  const filePath = join(docsDir, `${slug}.md`);
  if (!existsSync(filePath)) {
    cache[key] = `_(${slug}.md not bundled)_`;
    return cache[key]!;
  }
  cache[key] = await readFile(filePath, 'utf8');
  return cache[key]!;
}

/** Read a resource by URI. Returns null when the URI isn't recognized. */
export async function readMcpResource(
  uri: string,
  deps: McpResourceDeps
): Promise<McpResourceContents | null> {
  if (uri === URI_SCENE_AGENT) {
    return { uri, mimeType: 'text/markdown', text: await readContract(deps.docsDir, 'scene-agent', 'sceneAgent') };
  }
  if (uri === URI_CANVAS_AGENT) {
    return { uri, mimeType: 'text/markdown', text: await readContract(deps.docsDir, 'canvas-widget-agent', 'canvasAgent') };
  }
  if (uri === URI_ENTITIES) {
    return { uri, mimeType: 'text/markdown', text: renderHaEntitiesDoc(deps.haClient) };
  }
  if (uri === URI_DESIGNS_INDEX) {
    const lines = deps.designs.list().map(
      (p) => `- \`${p.slug}\` — ${p.name} (${p.source})`
    );
    const text = `# Design pack index\n\n${lines.join('\n')}\n`;
    return { uri, mimeType: 'text/markdown', text };
  }
  if (uri.startsWith('cosmos://designs/')) {
    const slug = uri.slice('cosmos://designs/'.length);
    const p = deps.designs.getBySlug(slug);
    if (!p) return null;
    return { uri, mimeType: 'text/markdown', text: p.content };
  }
  return null;
}

/** Test-only: drop the doc cache so subsequent reads hit disk again. */
export function _resetMcpResourceCache(): void {
  cache.sceneAgent = null;
  cache.canvasAgent = null;
}
