import { request as httpsRequest } from 'node:https';
import { rootCertificates } from 'node:tls';
import { Readable } from 'node:stream';
import { APPLE_ROOT_CA_PEM } from './appleRootCa.js';

/**
 * A `fetch`-shaped function over `node:https` with extra trust anchors.
 *
 * Node's global fetch cannot take a CA list without pulling in undici as a
 * dependency, and Apple's CDN chains to a root Node does not ship. Only what
 * the aerial code uses is implemented: GET/HEAD, request headers, a streamed
 * body, and status/headers on the way back.
 */
export function createHttpsFetch(extraCa: string[]): typeof fetch {
  const ca = [...rootCertificates, ...extraCa];
  return ((input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers: Record<string, string> = {};
      if (init?.headers) {
        for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k] = v;
      }
      const req = httpsRequest(url, { method: init?.method ?? 'GET', headers, ca }, (res) => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') h.set(k, v);
          else if (Array.isArray(v)) h.set(k, v.join(', '));
        }
        const status = res.statusCode ?? 0;
        const hasBody = !(status === 204 || status === 304 || (init?.method ?? 'GET') === 'HEAD');
        if (!hasBody) res.resume();
        resolve(
          new Response(hasBody ? (Readable.toWeb(res) as unknown as BodyInit) : null, {
            status,
            statusText: res.statusMessage ?? '',
            headers: h,
          }),
        );
      });
      req.on('error', (err) => reject(new TypeError(`fetch failed: ${err.message}`, { cause: err })));
      req.end();
    })) as typeof fetch;
}

/** fetch() that trusts Apple's own root in addition to the usual bundle. */
export const appleFetch: typeof fetch = createHttpsFetch([APPLE_ROOT_CA_PEM]);
