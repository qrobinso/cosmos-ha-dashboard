import type { SettingsRepo } from './settings.js';

/**
 * Per-server policy controlling whether sandboxed canvas iframes can issue
 * outbound HTTP requests through `cosmos.fetch(url, init)`. Enforcement happens
 * in the **display** (the parent of the sandboxed iframe does the fetch on its
 * behalf), so this object travels to every display via SceneState.
 *
 * - `off`        — `cosmos.fetch` is rejected with an error. Default for fresh
 *                  installs is `allowlist` with an empty list, which behaves
 *                  the same as `off` until the user adds a hostname.
 * - `allowlist`  — only requests whose URL host matches an entry (exact or
 *                  subdomain) are allowed.
 * - `any`        — any host is allowed. The user opted into this; surface a
 *                  warning in the admin UI.
 */
export type CanvasFetchMode = 'off' | 'allowlist' | 'any';

export type CanvasFetchPolicy = {
  mode: CanvasFetchMode;
  /** Lower-cased hostnames. `example.com` also matches `*.example.com`. */
  allowlist: string[];
};

export const DEFAULT_CANVAS_FETCH_POLICY: CanvasFetchPolicy = {
  mode: 'allowlist',
  allowlist: [],
};

const KEY = 'canvas_fetch_policy';

export function readCanvasFetchPolicy(settings: SettingsRepo): CanvasFetchPolicy {
  const raw = settings.get(KEY);
  if (!raw) return { ...DEFAULT_CANVAS_FETCH_POLICY };
  try {
    return normalizeCanvasFetchPolicy(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_CANVAS_FETCH_POLICY };
  }
}

export function writeCanvasFetchPolicy(settings: SettingsRepo, policy: CanvasFetchPolicy): CanvasFetchPolicy {
  const normalized = normalizeCanvasFetchPolicy(policy);
  settings.set(KEY, JSON.stringify(normalized));
  return normalized;
}

/** Coerce arbitrary JSON into a valid policy. Drops junk silently. */
export function normalizeCanvasFetchPolicy(input: unknown): CanvasFetchPolicy {
  const obj = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const mode: CanvasFetchMode =
    obj.mode === 'off' || obj.mode === 'any' || obj.mode === 'allowlist' ? obj.mode : 'allowlist';
  const rawList = Array.isArray(obj.allowlist) ? (obj.allowlist as unknown[]) : [];
  const seen = new Set<string>();
  const allowlist: string[] = [];
  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const cleaned = cleanHost(item);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    allowlist.push(cleaned);
  }
  return { mode, allowlist };
}

/** Strip scheme, path, port, whitespace; lowercase. Returns '' if unusable. */
function cleanHost(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (!s) return '';
  // Strip scheme if present.
  const schemeIdx = s.indexOf('://');
  if (schemeIdx >= 0) s = s.slice(schemeIdx + 3);
  // Strip path.
  const slash = s.indexOf('/');
  if (slash >= 0) s = s.slice(0, slash);
  // Strip port.
  const colon = s.indexOf(':');
  if (colon >= 0) s = s.slice(0, colon);
  // Reject obviously invalid hosts.
  if (!/^[a-z0-9.\-_]+$/.test(s)) return '';
  if (s.startsWith('.') || s.endsWith('.')) return '';
  return s;
}

/**
 * Pure host-match test. Used by both the display (real enforcement) and the
 * server (validation in tests + future server-side proxy). Hostname is
 * compared case-insensitively; an entry `example.com` matches `example.com`
 * and any subdomain (`api.example.com`, `a.b.example.com`).
 */
export function isHostAllowed(host: string, policy: CanvasFetchPolicy): boolean {
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
