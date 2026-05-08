import type { FastifyInstance } from 'fastify';
import type { SettingsRepo } from '../store/settings.js';
import type { HaClient } from '../ha/types.js';
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
}
