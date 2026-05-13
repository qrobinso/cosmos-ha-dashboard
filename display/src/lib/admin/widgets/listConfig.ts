// Shared helpers for ordered-string-list config fields (e.g. weather's
// secondary-info rows). These mutate-and-return the config object so a
// per-kind config component can do `config = addToList(config, key, v)`
// inside a `bind:config` flow.

/** Read an ordered string list from a config. Falls back to a legacy singular
 *  field if `key` is missing — used for back-compat. */
export function configList(
  config: Record<string, unknown>,
  key: string,
  legacyKey?: string,
): string[] {
  const v = config[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x !== '');
  if (legacyKey) {
    const legacy = config[legacyKey];
    if (typeof legacy === 'string' && legacy !== '') return [legacy];
  }
  return [];
}

/** Swap two list items (move `fromIdx` by `dir`). Returns a new config. */
export function moveListItem(
  config: Record<string, unknown>,
  key: string,
  fromIdx: number,
  dir: -1 | 1,
): Record<string, unknown> {
  const cur = configList(config, key);
  const target = fromIdx + dir;
  if (target < 0 || target >= cur.length) return config;
  const next = [...cur];
  const tmp = next[target];
  next[target] = next[fromIdx];
  next[fromIdx] = tmp;
  return { ...config, [key]: next };
}

/** Append `value` to the list (no-op if empty or already present). */
export function addToList(
  config: Record<string, unknown>,
  key: string,
  value: string,
): Record<string, unknown> {
  if (!value) return config;
  const cur = configList(config, key);
  if (cur.includes(value)) return config;
  return { ...config, [key]: [...cur, value] };
}

/** Remove `value` from the list. */
export function removeFromList(
  config: Record<string, unknown>,
  key: string,
  value: string,
): Record<string, unknown> {
  const cur = configList(config, key);
  return { ...config, [key]: cur.filter((x) => x !== value) };
}
