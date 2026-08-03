import { describe, it, expect } from 'vitest';
import { createYtDlpLookup, probeYtDlpAvailable } from '../src/musicvideo/ytdlp.js';
import type { SpawnFn } from '../src/musicvideo/ytdlp.js';

/** Minimal shape of a phase-2 (`yt-dlp -f 18 -j`) full JSON line. */
function ytdlpJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'abc123',
    title: 'David Bowie - Heroes (Official Video)',
    url: 'https://rr1.googlevideo.com/videoplayback?x=1',
    duration: 214,
    ...over,
  });
}

/** Minimal shape of a phase-1 (`--flat-playlist`) flat JSON line. Flat mode
 * does NOT provide categories/uploader_id/artist/track/album. */
function flatJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'abc123',
    title: 'David Bowie - Heroes (Official Video)',
    channel: 'David Bowie',
    uploader: 'David Bowie',
    channel_is_verified: true,
    duration: 214,
    view_count: 1000,
    url: 'https://www.youtube.com/watch?v=abc123',
    ...over,
  });
}

/** Builds a fake spawnFn that answers phase 1 (`--flat-playlist`) with
 * `flatLines` and phase 2 (anything else) with `phase2Json`, dispatching on
 * whether the invocation's args contain `--flat-playlist`. Records every
 * invocation's args for assertions. */
function twoPhaseFake(opts: {
  flatLines: string[];
  phase2Json?: string;
  phase2Ok?: boolean;
}): { spawnFn: SpawnFn; calls: string[][] } {
  const calls: string[][] = [];
  const spawnFn: SpawnFn = async (args) => {
    calls.push(args);
    if (args.includes('--flat-playlist')) {
      return { ok: true, stdout: opts.flatLines.join('\n') };
    }
    if (opts.phase2Ok === false) return { ok: false, stdout: '' };
    return { ok: true, stdout: opts.phase2Json ?? ytdlpJson() };
  };
  return { spawnFn, calls };
}

describe('createYtDlpLookup — two-phase search', () => {
  it('parses a successful search into a ResolvedVideo', async () => {
    const { spawnFn } = twoPhaseFake({ flatLines: [flatJson()] });
    const lookup = createYtDlpLookup({ spawnFn });
    expect(await lookup.search('david bowie heroes')).toEqual({
      status: 'ok',
      video: {
        videoId: 'abc123',
        streamUrl: 'https://rr1.googlevideo.com/videoplayback?x=1',
        duration: 214,
        title: 'David Bowie - Heroes (Official Video)',
      },
    });
  });

  it('phase 1 uses --flat-playlist and ytsearch5', async () => {
    const { spawnFn, calls } = twoPhaseFake({ flatLines: [flatJson()] });
    const lookup = createYtDlpLookup({ spawnFn });
    await lookup.search('david bowie heroes');
    const phase1 = calls[0];
    expect(phase1).toContain('--flat-playlist');
    expect(phase1).toContain('-j');
    expect(phase1.some((a) => a.startsWith('ytsearch5:'))).toBe(true);
    expect(phase1.some((a) => a.includes('david bowie heroes'))).toBe(true);
  });

  it('phase 2 pins format 18 and targets the WINNER\'s watch URL, not the first result\'s', async () => {
    // Winner (row 2, "Weary") is NOT first in the flat results — this is the
    // exact bug this feature exists to fix.
    const flatLines = [
      flatJson({ id: 'medley-id', title: 'Solange - Rise/Weary Medley (Live)', channel: 'solangeknowlesmusic', channel_is_verified: true, duration: 282, view_count: 100 }),
      // Carries official-video wording so it clears the confidence gate; a
      // bare "Weary" here would be read as a YouTube Art Track and rejected.
      flatJson({ id: 'weary-id', title: 'Solange - Weary (Official Video)', channel: 'solangeknowlesmusic', channel_is_verified: true, duration: 195, view_count: 100 }),
    ];
    const { spawnFn, calls } = twoPhaseFake({
      flatLines,
      phase2Json: ytdlpJson({ id: 'weary-id', title: 'Weary' }),
    });
    const lookup = createYtDlpLookup({ spawnFn });
    const result = await lookup.search('solange weary', { artist: 'Solange', title: 'Weary', durationSec: 195 });

    expect(result.status === 'ok' && result.video.videoId).toBe('weary-id');
    const phase2 = calls[1];
    expect(phase2).toContain('-f');
    expect(phase2).toContain('18');
    expect(phase2.some((a) => a === 'https://www.youtube.com/watch?v=weary-id')).toBe(true);
    expect(phase2.some((a) => a === 'https://www.youtube.com/watch?v=medley-id')).toBe(false);
  });

  it("yields 'none' when phase 1 fails", async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: false, stdout: '' }),
    });
    expect(await lookup.search('nope')).toEqual({ status: 'none' });
  });

  it("yields 'none' when phase 1 succeeds but phase 2 fails", async () => {
    const { spawnFn } = twoPhaseFake({ flatLines: [flatJson()], phase2Ok: false });
    const lookup = createYtDlpLookup({ spawnFn });
    expect(await lookup.search('x')).toEqual({ status: 'none' });
  });

  it("yields 'unavailable' when the phase-1 spawn itself fails", async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: false, stdout: '', spawnFailed: true }),
    });
    expect(await lookup.search('x')).toEqual({ status: 'unavailable' });
  });

  it("reports 'none' on malformed json", async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: 'not json at all' }),
    });
    expect(await lookup.search('nope')).toEqual({ status: 'none' });
  });

  it("reports 'none' on empty stdout (no search results)", async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: '   \n' }),
    });
    expect(await lookup.search('nope')).toEqual({ status: 'none' });
  });

  it('defaults duration to 0 when phase 2 does not report one', async () => {
    const { spawnFn } = twoPhaseFake({
      flatLines: [flatJson()],
      phase2Json: ytdlpJson({ duration: undefined }),
    });
    const lookup = createYtDlpLookup({ spawnFn });
    const r = await lookup.search('x');
    expect(r.status === 'ok' && r.video.duration).toBe(0);
  });

  it("reports 'unavailable' when the binary could not be spawned", async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: false, stdout: '', spawnFailed: true }),
    });
    expect(await lookup.search('x')).toEqual({ status: 'unavailable' });
  });

  it("never throws when the spawn seam itself rejects, and reports 'unavailable'", async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => {
        throw new Error('ENOENT: yt-dlp not found');
      },
    });
    await expect(lookup.search('x')).resolves.toEqual({ status: 'unavailable' });
  });

  it('streamUrlFor targets the video by id, not a search', async () => {
    let captured: string[] = [];
    const lookup = createYtDlpLookup({
      spawnFn: async (args) => {
        captured = args;
        return { ok: true, stdout: ytdlpJson() };
      },
    });
    const url = await lookup.streamUrlFor('abc123');
    expect(url).toBe('https://rr1.googlevideo.com/videoplayback?x=1');
    expect(captured.some((a) => a.startsWith('ytsearch1:'))).toBe(false);
    expect(captured).toContain('https://www.youtube.com/watch?v=abc123');
  });

  it('streamUrlFor returns null on failure', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: false, stdout: '' }),
    });
    expect(await lookup.streamUrlFor('abc123')).toBeNull();
  });

  it('streamUrlFor returns null when the binary is unavailable', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: false, stdout: '', spawnFailed: true }),
    });
    expect(await lookup.streamUrlFor('abc123')).toBeNull();
  });

  it('passes the configured timeout to the spawn function', async () => {
    let seen = 0;
    const lookup = createYtDlpLookup({
      timeoutMs: 1234,
      spawnFn: async (_args, timeoutMs) => {
        seen = timeoutMs;
        return { ok: true, stdout: ytdlpJson() };
      },
    });
    await lookup.search('x');
    expect(seen).toBe(1234);
  });
});

describe('probeYtDlpAvailable', () => {
  it('is true when --version exits cleanly', async () => {
    let captured: string[] = [];
    const ok = await probeYtDlpAvailable({
      spawnFn: async (args) => {
        captured = args;
        return { ok: true, stdout: '2024.08.06\n' };
      },
    });
    expect(ok).toBe(true);
    expect(captured).toEqual(['--version']);
  });

  it('is false when the binary is missing', async () => {
    expect(
      await probeYtDlpAvailable({
        spawnFn: async () => ({ ok: false, stdout: '', spawnFailed: true }),
      }),
    ).toBe(false);
  });

  it('never throws when the spawn seam rejects', async () => {
    await expect(
      probeYtDlpAvailable({
        spawnFn: async () => {
          throw new Error('boom');
        },
      }),
    ).resolves.toBe(false);
  });
});
