import type { FastifyInstance } from 'fastify';
import type { DesignPacksRepo } from '../store/design-packs.js';
import { parseDesignPack, previewFromFrontmatter } from '../designs/parse.js';

export type DesignRoutesDeps = {
  designs: DesignPacksRepo;
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

function findByIdOrSlug(repo: DesignPacksRepo, key: string) {
  return repo.getBySlug(key) ?? repo.get(key);
}

export function registerDesignRoutes(app: FastifyInstance, deps: DesignRoutesDeps): void {
  /** GET /api/designs — list with light preview shape for the dropdown. */
  app.get('/api/designs', async () => {
    return deps.designs.list().map((p) => {
      const parsed = parseDesignPack(p.content);
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        source: p.source,
        preview: previewFromFrontmatter(parsed.frontmatter),
      };
    });
  });

  /** GET /api/designs/:idOrSlug — full content + parsed split. */
  app.get<{ Params: { key: string } }>('/api/designs/:key', async (req, reply) => {
    const p = findByIdOrSlug(deps.designs, req.params.key);
    if (!p) return reply.code(404).send({ error: 'not found' });
    const parsed = parseDesignPack(p.content);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      source: p.source,
      content: p.content,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      parseErrors: parsed.errors,
    };
  });

  /** POST /api/designs — create a user pack. */
  app.post<{ Body: { slug?: unknown; name?: unknown; content?: unknown } }>(
    '/api/designs',
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const slug = body.slug;
      const name = body.name;
      const content = body.content;
      if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
        return reply.code(400).send({ error: 'slug must match ^[a-z0-9][a-z0-9-]*[a-z0-9]$ (3-64 chars)' });
      }
      if (typeof name !== 'string' || name.trim() === '') {
        return reply.code(400).send({ error: 'name must be a non-empty string' });
      }
      if (typeof content !== 'string' || content.trim() === '') {
        return reply.code(400).send({ error: 'content must be a non-empty string' });
      }
      if (deps.designs.getBySlug(slug)) {
        return reply.code(400).send({ error: `slug "${slug}" already exists` });
      }
      // Verify frontmatter (if any) is parseable. Body-only is allowed.
      const parsed = parseDesignPack(content);
      if (parsed.errors.length > 0) {
        return reply.code(400).send({ error: parsed.errors[0] });
      }
      const created = deps.designs.create({ slug, name, content, source: 'user' });
      return created;
    }
  );

  /** PATCH /api/designs/:idOrSlug — update name/content of a user pack. */
  app.patch<{ Params: { key: string }; Body: { name?: unknown; content?: unknown } }>(
    '/api/designs/:key',
    async (req, reply) => {
      const p = findByIdOrSlug(deps.designs, req.params.key);
      if (!p) return reply.code(404).send({ error: 'not found' });
      if (p.source === 'builtin') {
        return reply.code(403).send({ error: 'built-in design packs cannot be modified' });
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: { name?: string; content?: string } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || body.name.trim() === '') {
          return reply.code(400).send({ error: 'name must be a non-empty string' });
        }
        patch.name = body.name;
      }
      if (body.content !== undefined) {
        if (typeof body.content !== 'string' || body.content.trim() === '') {
          return reply.code(400).send({ error: 'content must be a non-empty string' });
        }
        const parsed = parseDesignPack(body.content);
        if (parsed.errors.length > 0) return reply.code(400).send({ error: parsed.errors[0] });
        patch.content = body.content;
      }
      return deps.designs.update(p.id, patch);
    }
  );

  /** DELETE /api/designs/:idOrSlug — remove a user pack. */
  app.delete<{ Params: { key: string } }>('/api/designs/:key', async (req, reply) => {
    const p = findByIdOrSlug(deps.designs, req.params.key);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (p.source === 'builtin') {
      return reply.code(403).send({ error: 'built-in design packs cannot be deleted' });
    }
    deps.designs.delete(p.id);
    return reply.code(204).send();
  });
}
