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

export async function registerStatic(
  app: FastifyInstance,
  dir: string,
  opts?: { devProxyTo?: string }
): Promise<void> {
  // Dev mode: when COSMOS_DEV_VITE_URL is set (the `npm run dev` script does
  // this), don't try to serve the static build at all — redirect everything
  // that isn't /api or /ws to the Vite dev server. This avoids the classic
  // "I have a stale browser tab at :8099 and Vite changed the chunk hashes
  // out from under me, now I get 404s on /_app/immutable/..." foot-gun: in
  // dev there should only be one source of display assets, and that's Vite.
  const devProxyTo = opts?.devProxyTo?.replace(/\/$/, '');
  if (devProxyTo) {
    app.log?.info?.(`dev mode: redirecting display traffic to ${devProxyTo}`);
    function redirect(req: FastifyRequest, reply: FastifyReply) {
      return reply.code(307).redirect(`${devProxyTo}${req.url}`);
    }
    app.get('/', redirect);
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return redirect(req, reply);
    });
    return;
  }

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
    // Only fall back to index.html for navigation requests (HTML pages). For
    // asset paths — anything under /_app/, /moods/, or with a file extension
    // in the last segment — return a real 404. Falling back to HTML would
    // poison the browser's strict-MIME check (e.g. when a stale cached
    // index.html references a since-rebuilt JS hash).
    const path = req.url.split('?')[0];
    const lastSeg = path.slice(path.lastIndexOf('/') + 1);
    const looksLikeAsset =
      path.startsWith('/_app/') ||
      path.startsWith('/moods/') ||
      /\.[a-z0-9]{1,8}$/i.test(lastSeg);
    if (looksLikeAsset) return reply.code(404).send({ error: 'not found' });
    return sendIndex(req, reply);
  });
}
