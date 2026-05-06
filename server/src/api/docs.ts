import type { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

export type DocsRoutesDeps = {
  /** Absolute path to the repo's `docs/` directory. The handler returns 503
   *  if it doesn't exist (e.g. in some packaging modes). */
  docsDir: string;
};

type DocEntry = { slug: string; title: string };

/** Pull the first `# Heading` line as the doc title; fall back to the slug. */
function extractTitle(markdown: string, slug: string): string {
  const m = markdown.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : slug;
}

/** Curated order so agent-facing contracts surface first. */
const ORDER: string[] = [
  'scene-agent',
  'canvas-widget-agent',
  'canvas-widget',
];

function rank(slug: string): number {
  const i = ORDER.indexOf(slug);
  return i === -1 ? ORDER.length + 1 : i;
}

/** Reject anything that isn't `<word>.md` so the slug param can't traverse. */
function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/i.test(slug);
}

export function registerDocsRoutes(app: FastifyInstance, deps: DocsRoutesDeps): void {
  app.get('/api/docs', async (_req, reply) => {
    if (!existsSync(deps.docsDir)) return reply.code(503).send({ error: 'docs not bundled' });
    const files = await readdir(deps.docsDir, { withFileTypes: true });
    const entries: DocEntry[] = [];
    for (const f of files) {
      if (!f.isFile()) continue;
      if (!f.name.endsWith('.md')) continue;
      const slug = f.name.replace(/\.md$/, '');
      if (!isSafeSlug(slug)) continue;
      const md = await readFile(join(deps.docsDir, f.name), 'utf8');
      entries.push({ slug, title: extractTitle(md, slug) });
    }
    entries.sort((a, b) => {
      const ra = rank(a.slug);
      const rb = rank(b.slug);
      return ra === rb ? a.slug.localeCompare(b.slug) : ra - rb;
    });
    return entries;
  });

  app.get<{ Params: { slug: string } }>('/api/docs/:slug', async (req, reply) => {
    if (!existsSync(deps.docsDir)) return reply.code(503).send({ error: 'docs not bundled' });
    const slug = req.params.slug;
    if (!isSafeSlug(slug)) return reply.code(400).send({ error: 'invalid slug' });
    const filePath = join(deps.docsDir, `${slug}.md`);
    // Belt-and-braces: ensure the resolved path is still inside docsDir.
    const normalizedDir = normalize(deps.docsDir + sep);
    if (!normalize(filePath).startsWith(normalizedDir)) {
      return reply.code(400).send({ error: 'invalid slug' });
    }
    if (!existsSync(filePath)) return reply.code(404).send({ error: 'not found' });
    const md = await readFile(filePath, 'utf8');
    reply.type('text/markdown; charset=utf-8');
    return md;
  });
}
