import { tool, type CoreTool } from 'ai';
import type { FastifyInstance } from 'fastify';
import type { HaClient } from '../ha/types.js';
import { createMcpTools, type McpToolDef } from '../mcp/tools.js';

export type AgentToolDeps = {
  /** The Fastify app — tool implementations route through `app.inject(...)`
   *  so the tools reuse the existing endpoints' validation + notification
   *  paths instead of re-implementing the work. */
  app: FastifyInstance;
  haClient: HaClient | null;
};

/** Convenience: full set of tools for streamText. Spread this into the
 *  `tools` arg. Derives the tool catalog from the canonical MCP registry
 *  in mcp/tools.ts so both layers stay in lockstep automatically. */
export function createAgentTools(deps: AgentToolDeps): Record<string, CoreTool> {
  const mcpTools = createMcpTools(deps);
  const out: Record<string, CoreTool> = {};
  for (const def of mcpTools) {
    out[def.name] = mcpToolToAiSdk(def);
  }
  return out;
}

/** Convert a McpToolDef to a Vercel AI SDK tool({...}) shape.
 *
 *  Confirm-required tools (delete_scene, delete_widget, activate_scene)
 *  have no `execute` — the chat UI renders a confirm card and drives the
 *  side-effect client-side, then posts back via addToolResult.
 *
 *  For all other tools the adapter wraps execute: it parses the JSON text
 *  from the MCP result back to a JS value, then applies summarizeForAgent
 *  (if present) before handing the result back to the model. */
function mcpToolToAiSdk(def: McpToolDef): CoreTool {
  if (def.confirmRequired) {
    return tool({
      description: def.description,
      parameters: def.inputSchema,
      // No execute — client handles confirmation + side effect.
    });
  }
  return tool({
    description: def.description,
    parameters: def.inputSchema,
    execute: async (args: unknown) => {
      const result = await def.execute(args);
      const text = result.content[0]?.text ?? '';
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* fall through with raw string */ }
      if (result.isError) return parsed;
      if (def.summarizeForAgent) {
        try { return def.summarizeForAgent(parsed); } catch { return parsed; }
      }
      return parsed;
    },
  });
}

/** Tool names the client must treat as confirm-required (render a confirm
 *  card, run the side effect, then call addToolResult). Exposed so the
 *  client and server stay in sync without duplicating the list.
 *
 *  IMPORTANT: this literal must stay in sync with `confirmRequired: true`
 *  flags in mcp/tools.ts. The drift-detector test in agent-tools.test.ts
 *  asserts they match at runtime. */
export const CONFIRM_REQUIRED_TOOLS = ['activate_scene', 'delete_scene', 'delete_widget'] as const;
export type ConfirmRequiredTool = (typeof CONFIRM_REQUIRED_TOOLS)[number];
