import { describe, it, expect } from 'vitest';
import { createYtDlpLookup } from '../src/musicvideo/ytdlp.js';

/** Minimal shape of the `yt-dlp -j` JSON line we care about. */
function ytdlpJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'abc123',
    title: 'David Bowie - Heroes (Official Video)',
    url: 'https://rr1.googlevideo.com/videoplayback?x=1',
    duration: 214,
    ...over,
  });
}

describe('createYtDlpLookup', () => {
  it('parses a successful search into a ResolvedVideo', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: ytdlpJson() }),
    });
    expect(await lookup.search('david bowie heroes')).toEqual({
      videoId: 'abc123',
      streamUrl: 'https://rr1.googlevideo.com/videoplayback?x=1',
      duration: 214,
      title: 'David Bowie - Heroes (Official Video)',
    });
  });

  it('pins format 18 and uses ytsearch1 for searches', async () => {
    let captured: string[] = [];
    const lookup = createYtDlpLookup({
      spawnFn: async (args) => {
        captured = args;
        return { ok: true, stdout: ytdlpJson() };
      },
    });
    await lookup.search('david bowie heroes');
    expect(captured).toContain('-f');
    expect(captured).toContain('18');
    expect(captured).toContain('-j');
    expect(captured.some((a) => a.startsWith('ytsearch1:'))).toBe(true);
    expect(captured.some((a) => a.includes('david bowie heroes'))).toBe(true);
  });

  it('returns null on a non-zero exit', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: false, stdout: '' }),
    });
    expect(await lookup.search('nope')).toBeNull();
  });

  it('returns null on malformed json', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: 'not json at all' }),
    });
    expect(await lookup.search('nope')).toBeNull();
  });

  it('returns null on empty stdout (no search results)', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: '   \n' }),
    });
    expect(await lookup.search('nope')).toBeNull();
  });

  it('returns null when json is well-formed but missing id or url', async () => {
    const noId = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: ytdlpJson({ id: undefined }) }),
    });
    expect(await noId.search('x')).toBeNull();

    const noUrl = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: ytdlpJson({ url: undefined }) }),
    });
    expect(await noUrl.search('x')).toBeNull();
  });

  it('defaults duration to 0 when absent', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: ytdlpJson({ duration: undefined }) }),
    });
    expect((await lookup.search('x'))?.duration).toBe(0);
  });

  it('reads only the first line when yt-dlp emits several', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => ({ ok: true, stdout: `${ytdlpJson()}\n${ytdlpJson({ id: 'second' })}` }),
    });
    expect((await lookup.search('x'))?.videoId).toBe('abc123');
  });

  it('never throws when the spawn itself rejects', async () => {
    const lookup = createYtDlpLookup({
      spawnFn: async () => {
        throw new Error('ENOENT: yt-dlp not found');
      },
    });
    await expect(lookup.search('x')).resolves.toBeNull();
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
