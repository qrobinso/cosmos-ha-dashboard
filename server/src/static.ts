import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export async function registerStatic(app: FastifyInstance, dir: string): Promise<void> {
  const root = resolve(dir);
  if (!existsSync(root)) {
    app.log?.warn?.(`static dir ${root} does not exist; skipping static serving`);
    return;
  }
  await app.register(fastifyStatic, { root, prefix: '/' });

  // SPA fallback: SvelteKit's adapter-static produces a single index.html for client-side
  // routing. Any non-API GET that didn't match a built file should serve index.html so the
  // client router (e.g. /admin/scenes) can take over.
  const indexFile = join(root, 'index.html');
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api') || req.url.startsWith('/ws')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
  });
  // Reference the path so unused-import linters stay quiet on platforms where existsSync
  // pre-checks would otherwise be useful.
  void indexFile;
}
