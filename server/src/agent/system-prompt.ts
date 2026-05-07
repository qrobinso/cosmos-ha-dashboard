import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HaClient } from '../ha/types.js';
import { renderHaEntitiesDoc } from '../api/docs.js';

/** The two contract markdowns are static — read once and held in process. */
const cache = { sceneAgent: null as string | null, canvasAgent: null as string | null };

function readContract(docsDir: string, slug: string, key: 'sceneAgent' | 'canvasAgent'): string {
  if (cache[key] !== null) return cache[key]!;
  const filePath = join(docsDir, `${slug}.md`);
  if (!existsSync(filePath)) {
    cache[key] = '';
    return '';
  }
  cache[key] = readFileSync(filePath, 'utf8');
  return cache[key]!;
}

const PREAMBLE = `You are Cosmos's in-product agent. The user is editing their wall-display dashboard \
and types natural-language asks; you call tools to inspect and modify scenes and canvas widgets.

Operating principles:

- Prefer per-widget patches (\`patch_widget\`, \`update_widget_content\`) over full-scene \
replacements. A full-scene update overwrites layout, background, and typography even if the \
user only asked to change one tile.
- For \`activate_scene\`, \`delete_scene\`, and \`delete_widget\`, the UI will surface a confirm \
button to the user — do not call these unless the user has explicitly asked for that action.
- When you need to know what entities exist in this Home Assistant install, call \
\`list_ha_entities\` (optionally filter by domain). The "LIVE HA ENTITIES" section at the end \
of this prompt is a snapshot from when the conversation started; it may be stale.
- Always tell the user what you're doing in plain language alongside any tool calls. They can't \
see the JSON.

The two contract documents below describe the exact JSON shapes for scenes and canvas widgets. \
Treat them as authoritative.`;

export type SystemPromptDeps = {
  docsDir: string;
  haClient: HaClient | null;
};

export function buildSystemPrompt(deps: SystemPromptDeps): string {
  const scene = readContract(deps.docsDir, 'scene-agent', 'sceneAgent');
  const canvas = readContract(deps.docsDir, 'canvas-widget-agent', 'canvasAgent');
  const haEntities = renderHaEntitiesDoc(deps.haClient);

  return [
    PREAMBLE,
    '',
    '═════════════════════════════════════════════════════════════',
    'SCENE AUTHORING CONTRACT',
    '═════════════════════════════════════════════════════════════',
    scene || '_(scene-agent.md not bundled)_',
    '',
    '═════════════════════════════════════════════════════════════',
    'CANVAS WIDGET CONTRACT',
    '═════════════════════════════════════════════════════════════',
    canvas || '_(canvas-widget-agent.md not bundled)_',
    '',
    '═════════════════════════════════════════════════════════════',
    'LIVE HA ENTITIES (snapshot)',
    '═════════════════════════════════════════════════════════════',
    haEntities,
  ].join('\n');
}

/** Test-only: drop the cached contract reads so subsequent calls re-read from disk. */
export function _resetSystemPromptCache(): void {
  cache.sceneAgent = null;
  cache.canvasAgent = null;
}
