import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export async function registerStatic(app: FastifyInstance, dir: string): Promise<void> {
  const root = resolve(dir);
  if (!existsSync(root)) {
    app.log?.warn?.(`static dir ${root} does not exist; skipping static serving`);
    return;
  }
  await app.register(fastifyStatic, { root, prefix: '/' });
}
