import type { FastifyInstance } from 'fastify';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, convertToCoreMessages } from 'ai';
import type { SettingsRepo } from '../store/settings.js';
import type { HaClient } from '../ha/types.js';
import type { DesignPacksRepo } from '../store/design-packs.js';
import { buildSystemPrompt } from '../agent/system-prompt.js';
import { createAgentTools, CONFIRM_REQUIRED_TOOLS } from '../agent/tools.js';

export type AgentRoutesDeps = {
  settings: SettingsRepo;
  haClient: HaClient | null;
  /** Path to the bundled `docs/` directory; the system-prompt builder reads
   *  the agent contracts from here. */
  docsDir: string;
  /** The Fastify app itself — passed back into tool implementations so they
   *  can reuse existing endpoints via `app.inject(...)`. Avoids reimplementing
   *  validation/notification logic. */
  app: FastifyInstance;
  /** Design packs repo — the system-prompt builder uses this to inject a
   *  selected pack's guidance section. */
  designs: DesignPacksRepo;
};

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';

type AgentSettings = {
  hasKey: boolean;
  model: string;
  /** The catalog of tool names the client should render as confirm cards. */
  confirmRequiredTools: readonly string[];
};

function readAgentSettings(settings: SettingsRepo): { key: string | null; model: string } {
  return {
    key: settings.get('agent_openrouter_key'),
    model: settings.get('agent_model') || DEFAULT_MODEL,
  };
}

export function registerAgentRoutes(app: FastifyInstance, deps: AgentRoutesDeps): void {
  /** GET /api/agent/settings — returns whether a key is set + the chosen
   *  model. Never returns the key itself; the browser doesn't need it. */
  app.get('/api/agent/settings', async (): Promise<AgentSettings> => {
    const cur = readAgentSettings(deps.settings);
    return {
      hasKey: !!cur.key,
      model: cur.model,
      confirmRequiredTools: CONFIRM_REQUIRED_TOOLS,
    };
  });

  /** GET /api/agent/time — server's wall-clock at request time. Used by the
   *  chat UI to anchor message timestamps to the server's clock instead of
   *  the browser's (which can drift, especially on wall tablets that may
   *  have NTP disabled). The browser computes offset = now - Date.now()
   *  once on mount and applies it to every message's createdAt. */
  app.get('/api/agent/time', async () => ({
    now: Date.now(),
    iso: new Date().toISOString(),
  }));

  /** PUT /api/agent/settings — set the OpenRouter key and/or model. Pass
   *  empty string for `key` to clear; omit to leave unchanged. */
  app.put<{ Body: { key?: unknown; model?: unknown } }>(
    '/api/agent/settings',
    async (req, reply) => {
      const body = req.body ?? {};
      if (body.key !== undefined) {
        if (typeof body.key !== 'string') return reply.code(400).send({ error: 'key must be a string' });
        if (body.key === '') {
          deps.settings.set('agent_openrouter_key', '');
        } else {
          deps.settings.set('agent_openrouter_key', body.key);
        }
      }
      if (body.model !== undefined) {
        if (typeof body.model !== 'string' || body.model.trim() === '') {
          return reply.code(400).send({ error: 'model must be a non-empty string' });
        }
        deps.settings.set('agent_model', body.model.trim());
      }
      const cur = readAgentSettings(deps.settings);
      return { hasKey: !!cur.key, model: cur.model, confirmRequiredTools: CONFIRM_REQUIRED_TOOLS };
    }
  );

  /** POST /api/agent/chat — streams a chat completion via OpenRouter. The
   *  Vercel AI SDK handles the protocol; we adapt the Web Response stream
   *  to Fastify's `reply.raw`. */
  app.post<{ Body: { messages?: unknown; designPackSlug?: unknown } }>('/api/agent/chat', async (req, reply) => {
    const { key, model } = readAgentSettings(deps.settings);
    if (!key) {
      return reply.code(503).send({
        error: 'OpenRouter API key not set. Add one in Settings → AI agent.',
      });
    }

    const messages = (req.body as { messages?: unknown })?.messages;
    if (!Array.isArray(messages)) {
      return reply.code(400).send({ error: 'messages must be an array' });
    }

    const designPackSlug = (req.body as { designPackSlug?: unknown })?.designPackSlug;
    let resolvedSlug: string | undefined = undefined;
    if (designPackSlug !== undefined && designPackSlug !== null && designPackSlug !== '') {
      if (typeof designPackSlug !== 'string') {
        return reply.code(400).send({ error: 'designPackSlug must be a string' });
      }
      if (!deps.designs.getBySlug(designPackSlug)) {
        return reply.code(400).send({ error: `design pack "${designPackSlug}" not found` });
      }
      resolvedSlug = designPackSlug;
    }

    const openrouter = createOpenAI({
      apiKey: key,
      baseURL: 'https://openrouter.ai/api/v1',
      // OpenRouter recommends these headers for usage attribution.
      headers: {
        'HTTP-Referer': 'https://github.com/qrobinso/cosmos-ha-dashboard',
        'X-Title': 'Cosmos Dashboard',
      },
    });

    const tools = createAgentTools({ app: deps.app, haClient: deps.haClient });
    const system = buildSystemPrompt(
      { docsDir: deps.docsDir, haClient: deps.haClient, designs: deps.designs },
      { designPackSlug: resolvedSlug }
    );

    const result = await streamText({
      model: openrouter(model),
      system,
      // useChat's UIMessage[] format → CoreMessage[] for the SDK.
      messages: convertToCoreMessages(messages as Parameters<typeof convertToCoreMessages>[0]),
      tools,
      // Multi-step tool loop. 5 is enough for: list → patch → verify, with headroom.
      maxSteps: 5,
    });

    // Pipe the AI SDK's data-stream Response onto Fastify's raw response.
    const response = result.toDataStreamResponse({
      // x-vercel-ai-data-stream lets the @ai-sdk/svelte useChat know this
      // is the data-stream protocol vs OpenAI-shaped raw stream.
      headers: { 'x-vercel-ai-data-stream': 'v1' },
    });

    reply.hijack();
    reply.raw.statusCode = response.status;
    response.headers.forEach((value: string, key: string) => {
      reply.raw.setHeader(key, value);
    });
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(value);
        }
      } catch (err) {
        console.error('agent stream pipe failed', err);
      } finally {
        reply.raw.end();
      }
    } else {
      reply.raw.end();
    }
  });
}
