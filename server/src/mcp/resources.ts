import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HaClient } from '../ha/types.js';
import { renderHaEntitiesDoc } from '../api/docs.js';

export type McpResourceDeps = {
  /** Absolute path to the bundled `docs/` directory (same one docs.ts uses). */
  docsDir: string;
  haClient: HaClient | null;
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

/** The catalog the MCP server advertises in `resources/list`. */
export function listMcpResources(): McpResourceListEntry[] {
  return [
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
  ];
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
  return null;
}

/** Test-only: drop the doc cache so subsequent reads hit disk again. */
export function _resetMcpResourceCache(): void {
  cache.sceneAgent = null;
  cache.canvasAgent = null;
}
