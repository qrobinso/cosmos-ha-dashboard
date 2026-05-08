import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import type { HaClient } from '../ha/types.js';
import { createMcpTools, type McpToolDef } from './tools.js';
import { listMcpResources, readMcpResource } from './resources.js';

export type CreateMcpServerDeps = {
  app: FastifyInstance;
  haClient: HaClient | null;
  docsDir: string;
  /** Server `name` advertised to clients. */
  serverName?: string;
  /** Server `version` advertised to clients. Pulled from addon/config.yaml
   *  at the call site for accuracy. */
  serverVersion?: string;
};

/** Build a fresh MCP server with all 11 tools + 3 resources registered.
 *  Caller wires the result to a transport (StreamableHTTPServerTransport
 *  in our case) via `server.connect(transport)`. */
export function createCosmosMcpServer(deps: CreateMcpServerDeps): McpServer {
  const server = new McpServer({
    name: deps.serverName ?? 'cosmos',
    version: deps.serverVersion ?? '0.0.0',
  });

  // Tools
  const tools = createMcpTools({ app: deps.app, haClient: deps.haClient });
  for (const t of tools) {
    registerTool(server, t);
  }

  // Resources — register each known URI as a static resource.
  for (const r of listMcpResources()) {
    server.resource(
      r.name,
      r.uri,
      { description: r.description, mimeType: r.mimeType },
      async (uri) => {
        const result = await readMcpResource(uri.toString(), {
          docsDir: deps.docsDir,
          haClient: deps.haClient,
        });
        if (!result) {
          throw new Error(`Unknown resource: ${uri.toString()}`);
        }
        return { contents: [result] };
      }
    );
  }

  return server;
}

/** Adapter from our internal McpToolDef to the SDK's `server.tool(...)`
 *  signature. The SDK's tool() accepts a zod object **shape** (the inner
 *  record), not the full z.object(...) instance. Our schemas are all
 *  z.object({...}) so we extract `.shape`. */
function registerTool(server: McpServer, def: McpToolDef): void {
  const shape = (def.inputSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
  server.tool(
    def.name,
    def.description,
    shape,
    async (args: unknown) => {
      const result = await def.execute(args);
      return result;
    }
  );
}
