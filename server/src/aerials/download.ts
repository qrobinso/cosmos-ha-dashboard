import { createWriteStream, renameSync, rmSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { VideoFileStore } from '../musicvideo/fileStore.js';
import type { AerialAsset } from './types.js';
import { appleFetch } from './fetch.js';

export type AerialDownloader = {
  /** Fetch the whole clip to disk unless it is already there, in flight, or
   *  the cap is 0. Never rejects; resolves true when a file was stored. */
  start(asset: AerialAsset): Promise<boolean>;
  /** Resolves once every in-flight download has finished. For tests and
   *  shutdown; the stream route never waits on this. */
  settled(): Promise<void>;
};

/**
 * Background downloads for aerial clips.
 *
 * Mirrors the music-video flow: the play that triggers this is already being
 * proxied, so nothing waits here. Bytes land in a `.part` file and are
 * renamed only on success, so a half-written clip can never be served.
 */
export function createAerialDownloader(deps: {
  files: VideoFileStore;
  fetchImpl?: typeof fetch;
  maxCacheBytes: () => number;
  log?: (msg: string) => void;
}): AerialDownloader {
  const doFetch = deps.fetchImpl ?? appleFetch;
  const log = deps.log ?? ((m) => console.log(`[aerials] ${m}`));
  const inFlight = new Map<string, Promise<boolean>>();

  async function run(asset: AerialAsset, dest: string): Promise<boolean> {
    const part = `${dest}.part`;
    try {
      const res = await doFetch(asset.sourceUrl);
      if (!res.ok || !res.body) {
        log(`download failed id=${asset.id} upstream=${res.status}`);
        return false;
      }
      await pipeline(
        Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(part),
      );
      renameSync(part, dest);
      const bytes = statSync(dest).size;
      deps.files.record(asset.id, bytes);
      log(`download ok id=${asset.id} bytes=${bytes}`);
      const removed = deps.files.evict(deps.maxCacheBytes());
      if (removed.length) log(`evicted ${removed.length} clip(s) to stay under the cap`);
      return true;
    } catch (err) {
      log(`download threw id=${asset.id} ${String(err)}`);
      return false;
    } finally {
      rmSync(part, { force: true });
    }
  }

  return {
    start(asset) {
      const existing = inFlight.get(asset.id);
      if (existing) return existing;
      if (deps.maxCacheBytes() <= 0 || deps.files.has(asset.id)) return Promise.resolve(false);
      const dest = deps.files.pathFor(asset.id);
      if (!dest) return Promise.resolve(false);

      const p = run(asset, dest).finally(() => inFlight.delete(asset.id));
      inFlight.set(asset.id, p);
      return p;
    },
    async settled() {
      while (inFlight.size > 0) await Promise.all([...inFlight.values()]);
    },
  };
}
