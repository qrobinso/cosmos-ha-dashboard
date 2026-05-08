import type { CanvasFetchPolicy } from '$lib/types';

/** Mirror of `server/src/store/canvasFetch.ts#isHostAllowed`. Kept duplicated
 *  rather than imported so the display app stays free of server imports. */
export function isHostAllowed(host: string, policy: CanvasFetchPolicy | undefined): boolean {
  if (!policy) return false;
  if (policy.mode === 'off') return false;
  if (policy.mode === 'any') return true;
  const h = host.trim().toLowerCase();
  if (!h) return false;
  for (const entry of policy.allowlist) {
    if (h === entry) return true;
    if (h.endsWith('.' + entry)) return true;
  }
  return false;
}
