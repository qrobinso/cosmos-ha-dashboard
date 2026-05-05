import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * When the addon is reached via HA Ingress, requests arrive with an
 * `X-Ingress-Path` header like `/api/hassio_ingress/<token>`. The browser
 * sees the page mounted at that prefix and resolves any absolute path
 * (`/_app/...`) against HA's root — which 404s. Rewriting absolute asset
 * paths in index.html to include the ingress prefix fixes this without
 * affecting direct LAN access (which has no such header).
 */
function rewriteForIngress(html: string, prefix: string): string {
  if (!prefix) return html;
  // Match href=" or src=" followed by a single leading slash (not "//").
  return html.replace(/((?:href|src)=")\/(?!\/)/g, `$1${prefix}/`);
}

export async function registerStatic(app: FastifyInstance, dir: string): Promise<void> {
  const root = resolve(dir);
  if (!existsSync(root)) {
    app.log?.warn?.(`static dir ${root} does not exist; skipping static serving`);
    return;
  }
  // index: false so we serve / ourselves with the ingress rewrite below.
  await app.register(fastifyStatic, { root, prefix: '/', index: false });

  const indexFile = join(root, 'index.html');
  const baseHtml = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : null;

  function sendIndex(req: FastifyRequest, reply: FastifyReply) {
    if (baseHtml === null) {
      return reply.code(404).send({ error: 'index.html missing' });
    }
    const prefix = (req.headers['x-ingress-path'] as string | undefined) ?? '';
    return reply.type('text/html').send(rewriteForIngress(baseHtml, prefix));
  }

  app.get('/', sendIndex);

  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return sendIndex(req, reply);
  });
}
