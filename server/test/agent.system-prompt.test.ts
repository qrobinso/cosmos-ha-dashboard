import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/store/migrations.js';
import { createDesignPacksRepo, type DesignPacksRepo } from '../src/store/design-packs.js';
import { buildSystemPrompt, _resetSystemPromptCache } from '../src/agent/system-prompt.js';
import { join } from 'node:path';

const docsDir = join(process.cwd(), '..', 'docs'); // monorepo: server/ → repo root → docs/

describe('buildSystemPrompt', () => {
  let designs: DesignPacksRepo;
  beforeEach(() => {
    _resetSystemPromptCache();
    const db = new Database(':memory:');
    runMigrations(db);
    designs = createDesignPacksRepo(db);
  });

  it('omits the DESIGN PACK section when no slug is provided', () => {
    const out = buildSystemPrompt({ docsDir, haClient: null, designs });
    expect(out).not.toContain('DESIGN PACK');
  });

  it('appends the DESIGN PACK section when a known slug is provided', () => {
    designs.create({
      slug: 'test-pack',
      name: 'Test Pack',
      content: '---\nname: Test Pack\n---\n\nBODY-MARKER-SENTINEL',
      source: 'user',
    });
    const out = buildSystemPrompt(
      { docsDir, haClient: null, designs },
      { designPackSlug: 'test-pack' }
    );
    expect(out).toContain('DESIGN PACK');
    expect(out).toContain('BODY-MARKER-SENTINEL');
  });

  it('omits the section silently when slug is unknown (no crash)', () => {
    const out = buildSystemPrompt(
      { docsDir, haClient: null, designs },
      { designPackSlug: 'no-such-slug' }
    );
    expect(out).not.toContain('DESIGN PACK');
  });

  it('includes the design-system reconcile-vs-create workflow in the preamble', () => {
    const out = buildSystemPrompt({ docsDir, haClient: null, designs });
    expect(out).toContain('reconcile before you build');
    expect(out).toContain('the design dropdown above');
  });

  it('bundles the wall-display principles before the scene contract', () => {
    const out = buildSystemPrompt({ docsDir, haClient: null, designs });
    expect(out).toContain('WALL DISPLAY PRINCIPLES');
    expect(out).toContain('The 3-second rule');
    expect(out.indexOf('WALL DISPLAY PRINCIPLES')).toBeLessThan(
      out.indexOf('SCENE AUTHORING CONTRACT')
    );
  });
});
