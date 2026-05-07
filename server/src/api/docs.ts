import type { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import type { HaClient, EntityState } from '../ha/types.js';

export type DocsRoutesDeps = {
  /** Absolute path to the repo's `docs/` directory. The handler returns 503
   *  if it doesn't exist (e.g. in some packaging modes). */
  docsDir: string;
  /** Optional HA client. When provided, a synthetic doc at slug `ha-entities`
   *  renders the current HA entity cache as markdown. Useful for the agent
   *  contract: a user can copy the rendered text into an LLM system prompt
   *  so the agent knows which entity_ids exist on this install. */
  haClient?: HaClient | null;
};

/** The synthetic slug for the live HA-entities snapshot. */
const HA_ENTITIES_SLUG = 'ha-entities';

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
  HA_ENTITIES_SLUG,
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
    // Synthetic live-data doc — listed even when HA isn't connected so the
    // user finds it; the get-handler renders an explanation in that case.
    entries.push({ slug: HA_ENTITIES_SLUG, title: 'Home Assistant entities (live)' });
    entries.sort((a, b) => {
      const ra = rank(a.slug);
      const rb = rank(b.slug);
      return ra === rb ? a.slug.localeCompare(b.slug) : ra - rb;
    });
    return entries;
  });

  app.get<{ Params: { slug: string } }>('/api/docs/:slug', async (req, reply) => {
    const slug = req.params.slug;
    if (!isSafeSlug(slug)) return reply.code(400).send({ error: 'invalid slug' });
    if (slug === HA_ENTITIES_SLUG) {
      reply.type('text/markdown; charset=utf-8');
      return renderHaEntitiesDoc(deps.haClient ?? null);
    }
    if (!existsSync(deps.docsDir)) return reply.code(503).send({ error: 'docs not bundled' });
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

/** Render the current HA entity cache as agent-friendly markdown. Grouped by
 *  domain, with the entity_id, friendly_name, state, unit, and device_class
 *  (when present). The whole page is a static snapshot — refresh to update. */
function renderHaEntitiesDoc(haClient: HaClient | null): string {
  const header =
    `# Home Assistant entities (live)\n\n` +
    `> Snapshot of every entity Cosmos has cached from your Home Assistant install.\n` +
    `> Tap **Copy markdown** above and paste it into your agent's system prompt so it knows which \`entity_id\`s exist on this install.\n` +
    `> The snapshot regenerates each time you load this page.\n\n`;

  if (!haClient) {
    return (
      header +
      `_Home Assistant is not connected on this Cosmos instance. Set \`HA_URL\` and \`HA_TOKEN\` (or run as an HA add-on) to populate the entity cache._\n`
    );
  }

  const all = haClient.listEntities();
  if (all.length === 0) {
    return header + `_The entity cache is empty. Wait a few seconds after server start and refresh._\n`;
  }

  // Group by domain.
  const byDomain = new Map<string, EntityState[]>();
  for (const e of all) {
    const dot = e.entity_id.indexOf('.');
    const domain = dot > 0 ? e.entity_id.slice(0, dot) : 'unknown';
    const list = byDomain.get(domain) ?? [];
    list.push(e);
    byDomain.set(domain, list);
  }

  const summary =
    `**${all.length}** entities across **${byDomain.size}** domains. ` +
    `Snapshot taken ${new Date().toISOString()}.\n\n`;

  const domains = [...byDomain.keys()].sort();
  const sections: string[] = [];

  for (const domain of domains) {
    const list = byDomain.get(domain)!.slice().sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    const lines: string[] = [];
    lines.push(`## ${domain} (${list.length})\n`);
    lines.push(`| Entity ID | Friendly name | State | Unit / class |`);
    lines.push(`|---|---|---|---|`);
    for (const e of list) {
      const a = (e.attributes ?? {}) as Record<string, unknown>;
      const friendly = typeof a.friendly_name === 'string' ? a.friendly_name : '';
      const unit =
        typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : '';
      const deviceClass =
        typeof a.device_class === 'string' ? a.device_class : '';
      const meta = [unit, deviceClass].filter(Boolean).join(' · ');
      lines.push(
        `| \`${e.entity_id}\` | ${escapeCell(friendly)} | ${escapeCell(e.state)} | ${escapeCell(meta)} |`
      );
    }
    sections.push(lines.join('\n'));
  }

  return header + summary + sections.join('\n\n') + '\n';
}

/** Replace pipes and newlines so cell content doesn't break the markdown table. */
function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
}
