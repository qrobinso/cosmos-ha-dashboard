import type { FastifyReply } from 'fastify';
import { createReadStream, statSync } from 'node:fs';

/**
 * A play, as opposed to one of the many range requests a browser issues per
 * play. Counting every request would rank a long video above a popular one
 * purely because it needed more chunks.
 */
export function isPlayStart(range: string | undefined): boolean {
  if (!range) return true;
  return /^bytes=0-/.test(range.trim());
}

/**
 * Serve a locally cached video, honouring Range so the player can seek.
 * Shared by the music-video and aerial stream routes; both hold bytes that
 * never change for a given id, hence the immutable cache header.
 */
export function sendLocalFile(
  reply: FastifyReply,
  path: string,
  range: string | undefined,
): FastifyReply {
  const size = statSync(path).size;
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;

  reply.header('accept-ranges', 'bytes');
  reply.header('content-type', 'video/mp4');
  reply.header('cache-control', 'public, max-age=604800, immutable');

  if (m) {
    const start = m[1] ? Number.parseInt(m[1], 10) : 0;
    const end = m[2] ? Number.parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start >= size || end < start) {
      reply.header('content-range', `bytes */${size}`);
      return reply.code(416).send();
    }
    const last = Math.min(end, size - 1);
    reply.header('content-range', `bytes ${start}-${last}/${size}`);
    reply.header('content-length', String(last - start + 1));
    reply.code(206);
    return reply.send(createReadStream(path, { start, end: last }));
  }

  reply.header('content-length', String(size));
  reply.code(200);
  return reply.send(createReadStream(path));
}
