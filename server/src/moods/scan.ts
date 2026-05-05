import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MOOD_CATALOG } from './catalog.js';
import type { MoodCatalogEntry } from './types.js';

/**
 * Scan the moods folder for `.mp4` files and merge with catalog metadata.
 * Files not in the catalog still appear with a humanized label and empty tags
 * so the user can drop in any clip and select it from the manual dropdown.
 */
export function scanMoodsDir(dir: string | null): MoodCatalogEntry[] {
  if (!dir || !existsSync(dir)) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp4'));
  } catch {
    return [];
  }
  const byId = new Map<string, MoodCatalogEntry>();
  for (const c of MOOD_CATALOG) byId.set(c.id, c);

  const out: MoodCatalogEntry[] = [];
  for (const file of names.sort()) {
    const id = file.replace(/\.mp4$/i, '');
    const meta = byId.get(id);
    if (meta) {
      out.push({ ...meta, file });
    } else {
      out.push({ id, label: humanize(id), file, tags: [] });
    }
  }
  return out;
}

function humanize(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Resolve the moods directory: explicit > <staticDir>/moods > display/static/moods. */
export function resolveMoodsDir(opts: { explicit: string | null; staticDir: string; repoRoot: string }): string | null {
  if (opts.explicit && existsSync(opts.explicit)) return opts.explicit;
  const fromStatic = join(opts.staticDir, 'moods');
  if (existsSync(fromStatic) && safeIsDir(fromStatic)) return fromStatic;
  const fromSrc = join(opts.repoRoot, 'display', 'static', 'moods');
  if (existsSync(fromSrc) && safeIsDir(fromSrc)) return fromSrc;
  return null;
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
