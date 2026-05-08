import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { SettingsRepo } from '../store/settings.js';
import type { HaClient } from '../ha/types.js';
import { createCosmosMcpServer } from '../mcp/server.js';
import {
  getToken,
  regenerateToken,
  isEnabled,
  setEnabled,
} from '../store/mcp-token.js';

export type McpRoutesDeps = {
  app: FastifyInstance;
  settings: SettingsRepo;
  haClient: HaClient | null;
  /** Path to the bundled docs/ directory; passed through to the MCP server
   *  factory so the resources can read the contracts off disk. */
  docsDir: string;
  /** Addon version to advertise to MCP clients. Optional; defaults to
   *  '0.0.0'. */
  serverVersion?: string;
};

type McpStatusResponse = {
  enabled: boolean;
  hasToken: boolean;
  /** Returned to the admin UI (same origin) so the user can copy it.
   *  Never returned from the /mcp transport endpoint. */
  token: string | null;
};

export function registerMcpRoutes(app: FastifyInstance, deps: McpRoutesDeps): void {
  /** GET /api/agent/mcp — settings card payload. */
  app.get('/api/agent/mcp', async (): Promise<McpStatusResponse> => {
    return {
      enabled: isEnabled(deps.settings),
      hasToken: getToken(deps.settings) !== null,
      token: getToken(deps.settings),
    };
  });

  /** POST /api/agent/mcp/enable — toggle the MCP server on or off. When
   *  enabling for the first time, automatically generate a token so the
   *  user doesn't have to make a second click. */
  app.post<{ Body: { enabled?: unknown } }>(
    '/api/agent/mcp/enable',
    async (req, reply): Promise<McpStatusResponse> => {
      const enabled = req.body?.enabled === true;
      setEnabled(deps.settings, enabled);
      if (enabled && getToken(deps.settings) === null) {
        regenerateToken(deps.settings);
      }
      return {
        enabled: isEnabled(deps.settings),
        hasToken: getToken(deps.settings) !== null,
        token: getToken(deps.settings),
      };
    }
  );

  /** POST /api/agent/mcp/regenerate — produce a new token. Old token is
   *  invalidated as soon as the new one is written. */
  app.post('/api/agent/mcp/regenerate', async (): Promise<McpStatusResponse> => {
    regenerateToken(deps.settings);
    return {
      enabled: isEnabled(deps.settings),
      hasToken: getToken(deps.settings) !== null,
      token: getToken(deps.settings),
    };
  });

  registerMcpTransport(app, deps);
}

/** Auth preHandler — runs before every /mcp request. Returns 503 if MCP
 *  isn't enabled or no token is set, 401 if the bearer is missing/wrong,
 *  passes through otherwise. */
function mcpAuth(deps: { settings: SettingsRepo }) {
  return async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!isEnabled(deps.settings)) {
      reply.code(503).send({ error: 'MCP server not enabled' });
      return reply;
    }
    const expected = getToken(deps.settings);
    if (!expected) {
      reply.code(503).send({ error: 'MCP token not generated' });
      return reply;
    }
    const header = req.headers.authorization ?? '';
    const got = header.replace(/^Bearer\s+/i, '');
    // timingSafeEqual requires equal-length buffers — short-circuit length
    // mismatch with the same error so the client can't infer length.
    const expectedBuf = Buffer.from(expected);
    const gotBuf = Buffer.from(got);
    const ok = gotBuf.length === expectedBuf.length && timingSafeEqual(gotBuf, expectedBuf);
    if (!ok) {
      reply.code(401).send({ error: 'invalid or missing bearer token' });
      return reply;
    }
  };
}

/** Mount the MCP transport. Called from registerMcpRoutes after the
 *  settings endpoints. */
export function registerMcpTransport(app: FastifyInstance, deps: McpRoutesDeps): void {
  const auth = mcpAuth({ settings: deps.settings });

  // POST /mcp — JSON-RPC over HTTP, optionally upgrading to SSE for
  // long-running tool calls. The SDK transport handles the protocol
  // entirely; we just hand it the raw req/res streams.
  app.post('/mcp', { preHandler: auth }, async (req, reply) => {
    const server = createCosmosMcpServer({
      app: deps.app,
      haClient: deps.haClient,
      docsDir: deps.docsDir,
      serverVersion: deps.serverVersion,
    });
    const transport = new StreamableHTTPServerTransport({
      // Stateless mode — no session ID, every POST is independent. Matches
      // our stateless tool-execution model (every tool call is a fresh
      // app.inject, no session state to track).
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      console.error('[mcp] transport error', err);
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
      }
      try { reply.raw.end(); } catch { /* ignore */ }
    } finally {
      try { await transport.close(); } catch { /* ignore */ }
      try { await server.close(); } catch { /* ignore */ }
    }
  });

  // GET /mcp returns 405 — the StreamableHTTP spec uses POST for client→
  // server and reserves GET for server-initiated SSE in stateful mode,
  // which we don't support.
  app.get('/mcp', { preHandler: auth }, async (_req, reply) => {
    reply.code(405).send({ error: 'GET not supported in stateless mode; POST to /mcp instead' });
  });
}
