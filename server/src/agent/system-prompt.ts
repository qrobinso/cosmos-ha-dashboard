import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HaClient } from '../ha/types.js';
import type { DesignPacksRepo } from '../store/design-packs.js';

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

const PREAMBLE = `You are Cosmos's in-product agent. The user is editing their wall-display \
dashboard and types natural-language asks; you call tools to inspect and modify scenes and \
canvas widgets.

Operating principles:

- Prefer per-widget patches (\`patch_widget\`, \`update_widget_content\`) over full-scene \
replacements. A full-scene update overwrites layout, background, and typography even if the \
user only asked to change one tile.
- For \`activate_scene\`, \`delete_scene\`, and \`delete_widget\`, the UI will surface a confirm \
button to the user — do not call these unless the user has explicitly asked for that action.

═══════════════════════════════════════════════════════════════════════
ENTITY ID DISCIPLINE — the #1 way you break canvases. Read this twice.
═══════════════════════════════════════════════════════════════════════

When you write a canvas widget that references Home Assistant data:

1. **Only use entity_ids you have actually seen** in a \`list_ha_entities\` \
response from THIS conversation. NEVER invent entity_ids based on common \
naming conventions. The user does NOT have \`weather.home\`, \`sensor.power\`, \
\`light.kitchen\`, or \`media_player.spotify\` unless you can point to that exact \
id in a tool result. They may have \`weather.kewr_daynight\`, \
\`sensor.living_room_temperature\`, \`light.kitchen_main\`, etc. Pick the \
closest real match.

2. **If a referenced entity_id doesn't exist on this install, the literal \
template string \`{{ states("...") }}\` will appear on the wall** — Home \
Assistant cannot render a template against an entity that isn't there, and \
the unrendered Jinja leaks through the canvas. This is broken output, not a \
warning. PREVENT THIS by always reading the catalog first.

3. **Always wrap entity reads in defensive defaults** so a temporary \
unavailable / unknown state doesn't display as "None" or "unavailable":

   - \`{{ states("sensor.foo") | default("—") }}\`
   - \`{{ state_attr("weather.home", "temperature") | round(0) | default("—") }}\`
   - \`{% if states("sensor.foo") not in ["unknown", "unavailable", "none"] %}{{ states("sensor.foo") }}{% else %}—{% endif %}\`

4. **If no matching entity exists, do NOT write a templated canvas.** Tell the \
user in plain language that you need them to pick an entity, OR write a \
canvas with placeholder static content and ask them to point you at the \
right entity_id next.

5. When the user asks for "weather", inspect the live entities and pick the \
\`weather.*\` entity that exists. Same for "temperature" → look at \
\`sensor.*\` entities with \`device_class: temperature\`. Same for any other \
domain. Never guess.

The HA entity catalog is NOT pre-loaded in this prompt — the user's install \
can have hundreds of entities, and dumping them upfront would cost the user a \
lot of tokens on every turn for catalogs you may not even consult. \
Call \`list_ha_entities\` only when an ask actually depends on entity data, \
and prefer the \`domain\` filter (\`{ domain: 'weather' }\`, \`{ domain: 'sensor' }\`, \
etc.) so the response stays small. If a single ask needs entities from \
multiple domains, make multiple filtered calls rather than fetching the whole \
catalog. Recall a previously-fetched list from earlier in the same conversation \
instead of re-calling.

How to talk to the user:

- The user is configuring their wall display, not debugging code. Use plain language. Avoid \
technical jargon like "CORS", "sandboxed iframe", "null origin", "Jinja", "WebSocket", \
"SQLite", "REST API", "JSON", "schema", "render_template", or implementation acronyms when \
talking to them. If a request can't be fulfilled, say what won't work in human terms ("this \
canvas can't load images from that website" — not "the iframe sandbox blocks cross-origin \
fetches").
- Don't echo widget IDs, scene IDs, or other long identifiers into messages unless the user \
asked for them. Refer to things by name ("the Morning scene", "your power sensor canvas").
- When the user mentions a canvas by name ("the news-headlines canvas", "my power tile"), use \
\`list_widgets({ kind: 'canvas', name: '<name>' })\` to find it — \`config.name\` on a canvas \
is the user's label, set in the editor. If they create a canvas without a name, suggest one \
when you save so you can both refer to it later.
- Keep replies short. One sentence is often enough. If you ran a tool, the user already sees \
the result card — you don't need to repeat what's in it.
- Don't paste code blocks, JSON payloads, or configuration files at the user. They can't drop \
those anywhere useful from chat. If you wrote a canvas, just say "I updated the canvas" — the \
new HTML is already on their wall.
- Never refer the user to the contract documents in this prompt. Those are for your reference. \
Translate what you need from them into plain language.

The two contract documents below describe the exact JSON shapes for scenes and canvas widgets. \
Treat them as authoritative for YOUR tool calls; do not paraphrase or quote them to the user.`;

export type SystemPromptDeps = {
  docsDir: string;
  haClient: HaClient | null;
  designs: DesignPacksRepo;
};

export type SystemPromptOpts = {
  /** Slug of a design pack to append to the prompt. Unknown slugs are
   *  silently ignored (the prompt builds without the section) so a stale
   *  client localStorage value never bricks the chat route. */
  designPackSlug?: string;
};

const DESIGN_PACK_PREAMBLE =
  'When a design pack is provided below, use its YAML frontmatter tokens for ' +
  'exact values (colors, typography, spacing) and the body prose for taste / voice. ' +
  'Token references like {colors.primary} should be resolved to the matching value ' +
  "from the pack's frontmatter when emitting scene/widget config. Never override " +
  'scene-API rules from the contracts above.';

export function buildSystemPrompt(deps: SystemPromptDeps, opts: SystemPromptOpts = {}): string {
  const scene = readContract(deps.docsDir, 'scene-agent', 'sceneAgent');
  const canvas = readContract(deps.docsDir, 'canvas-widget-agent', 'canvasAgent');
  // The HA entity catalog used to be embedded here as a snapshot. It was
  // removed because the catalog can run into the hundreds of entities and
  // most asks don't need any of them — paying that token cost on every turn
  // hurts responsiveness and the user's bill. Agents that need entities call
  // `list_ha_entities` (with a domain filter) on demand.
  void deps.haClient;

  const sections: string[] = [
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
  ];

  if (opts.designPackSlug) {
    const pack = deps.designs.getBySlug(opts.designPackSlug);
    if (pack) {
      sections.push(
        '',
        '═════════════════════════════════════════════════════════════',
        `DESIGN PACK — ${pack.name}`,
        '═════════════════════════════════════════════════════════════',
        DESIGN_PACK_PREAMBLE,
        '',
        pack.content,
      );
    }
  }

  return sections.join('\n');
}

/** Test-only: drop the cached contract reads so subsequent calls re-read from disk. */
export function _resetSystemPromptCache(): void {
  cache.sceneAgent = null;
  cache.canvasAgent = null;
}
