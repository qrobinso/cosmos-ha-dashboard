import { describe, it, expect } from 'vitest';
import {
  scoreCandidate,
  pickBest,
  explainCandidate,
  hasOfficialVideoWords,
  MIN_SCORE,
  type Candidate,
  type ScoreContext,
} from '../src/musicvideo/score.js';

/** Real yt-dlp output for "Solange Weary official music video", captured by hand. */
const FIXTURE: Candidate[] = [
  {
    videoId: 'row1-medley',
    title: 'Solange - Rise/Weary Medley (Live from The Tonight Show Starring Jimmy Fallon)',
    channel: 'solangeknowlesmusic',
    verified: true,
    durationSec: 282,
    viewCount: null,
  },
  {
    videoId: 'row2-weary',
    title: 'Weary',
    channel: 'solangeknowlesmusic',
    verified: true,
    durationSec: 195,
    viewCount: null,
  },
  {
    videoId: 'row3-lyrics',
    title: 'SOLANGE - WEARY (OFFICIAL LYRICS)',
    channel: 'The Miscellaneous',
    verified: false,
    durationSec: 196,
    viewCount: null,
  },
  {
    videoId: 'row4-cranes',
    title: 'Solange - Cranes in the Sky (Official Video)',
    channel: 'solangeknowlesmusic',
    verified: true,
    durationSec: 273,
    viewCount: null,
  },
  {
    videoId: 'row5-remix',
    title: 'Solange Knowles - Weary (REMIX) | By Matty The Chef',
    channel: 'MTC MUSIC TV (MTC MUSIC TV)',
    verified: false,
    durationSec: 317,
    viewCount: null,
  },
  {
    videoId: 'row6-visual',
    title: 'weary - solange | visual exploration',
    channel: 'dalexisb',
    verified: false,
    durationSec: 195,
    viewCount: null,
  },
];

const CTX: ScoreContext = { artist: 'Solange', title: 'Weary', durationSec: 195 };

describe('scoreCandidate / pickBest — Solange fixture', () => {
  it('rejects every candidate: this song has no official music video', () => {
    // "Weary" has no official video. The bare "Weary" upload on Solange's own
    // channel is a YouTube Art Track (auto-generated audio), and everything
    // else here is a medley, a lyric video, a remix, a fan edit, or a
    // different song. Correct behaviour is to play nothing at all.
    const winner = pickBest(FIXTURE, CTX)!;
    expect(scoreCandidate(winner, CTX)).toBeLessThan(MIN_SCORE);
  });

  it('penalizes the bare-titled artist upload as an Art Track', () => {
    const artTrack = FIXTURE.find((c) => c.videoId === 'row2-weary')!;
    // Right channel, verified, exact duration — it would otherwise win easily.
    const withoutArtTrackRule = scoreCandidate(
      { ...artTrack, title: 'Solange - Weary (Official Video)' },
      CTX,
    );
    expect(scoreCandidate(artTrack, CTX)).toBeLessThan(withoutArtTrackRule);
    expect(scoreCandidate(artTrack, CTX)).toBeLessThan(MIN_SCORE);
  });

  it('keeps the junk well below the Art Track, let alone the gate', () => {
    const byId = Object.fromEntries(
      FIXTURE.map((c) => [c.videoId, scoreCandidate(c, CTX)]),
    );
    for (const id of ['row1-medley', 'row3-lyrics', 'row5-remix', 'row6-visual']) {
      expect(byId[id]).toBeLessThan(MIN_SCORE);
    }
    // The medley and the remix are actively worse than the audio upload.
    expect(byId['row1-medley']).toBeLessThan(byId['row2-weary']);
    expect(byId['row5-remix']).toBeLessThan(byId['row2-weary']);
  });
});

describe('Art Track detection', () => {
  const base: Candidate = {
    videoId: 'x',
    title: '',
    channel: 'Radiohead',
    verified: true,
    durationSec: 264,
    viewCount: 10_000_000,
  };
  const ctx: ScoreContext = { artist: 'Radiohead', title: 'Karma Police', durationSec: 264 };

  it('penalizes a bare song title on the artist channel', () => {
    const artTrack = scoreCandidate({ ...base, title: 'Karma Police' }, ctx);
    const video = scoreCandidate({ ...base, title: 'Radiohead - Karma Police' }, ctx);
    expect(artTrack).toBeLessThan(video);
  });

  it('does NOT penalize the "Artist - Song" form, which is the real video', () => {
    // Verified against live search: neither Radiohead's nor Kendrick Lamar's
    // official videos carry "official video" wording, so keying this rule on
    // that wording instead of the bare title would reject both.
    const video = scoreCandidate({ ...base, title: 'Radiohead - Karma Police' }, ctx);
    expect(video).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it('does not fire when the channel is not the artist', () => {
    const bare = { ...base, title: 'Karma Police', channel: 'Some Fan Channel', verified: false };
    const withArtistChannel = { ...bare, channel: 'Radiohead', verified: false };
    expect(scoreCandidate(bare, ctx)).toBeGreaterThan(scoreCandidate(withArtistChannel, ctx));
  });

  it('does not fire when the title carries official-video wording', () => {
    const a = scoreCandidate({ ...base, title: 'Karma Police (Official Video)' }, ctx);
    expect(a).toBeGreaterThanOrEqual(MIN_SCORE);
  });
});

describe('hasOfficialVideoWords', () => {
  it('matches the words in any arrangement, not just "official video"', () => {
    expect(hasOfficialVideoWords('Song (Official Video)')).toBe(true);
    expect(hasOfficialVideoWords('Song (Official Music Video)')).toBe(true);
    expect(hasOfficialVideoWords('Song [Official] ... Video')).toBe(true);
    expect(hasOfficialVideoWords('OFFICIAL VIDEOS - Song')).toBe(true);
  });

  it('requires both words', () => {
    expect(hasOfficialVideoWords('Song (Official Audio)')).toBe(false);
    expect(hasOfficialVideoWords('Song (Video)')).toBe(false);
    expect(hasOfficialVideoWords('Song')).toBe(false);
  });
});

/**
 * Real yt-dlp output for "David Bowie Heroes official music video".
 *
 * This fixture is the guard for the duration retune. The track is the 6:11
 * album cut; the correct answer is the 3:29 official STUDIO video, even though
 * the official LIVE video's runtime is far closer to the album length. An
 * earlier weighting made duration dominant and picked the live cut — if this
 * test goes red, duration has been over-weighted again.
 */
const BOWIE_FIXTURE: Candidate[] = [
  {
    videoId: 'bowie-studio',
    title: 'David Bowie - "Heroes" (Official Video) [HD]',
    channel: 'David Bowie',
    verified: true,
    durationSec: 209,
    viewCount: 50_000_000,
  },
  {
    videoId: 'bowie-reupload-long',
    title: 'David Bowie - Heroes',
    channel: 'Broken Ridge Records',
    verified: false,
    durationSec: 453,
    viewCount: 100_000,
  },
  {
    videoId: 'bowie-christiane',
    title: 'David Bowie - Heroes [Christiane F. - Wir Kinder Vom Bahnhof Zoo]',
    channel: 'The Alice Project',
    verified: false,
    durationSec: 476,
    viewCount: 100_000,
  },
  {
    videoId: 'bowie-live',
    title: 'David Bowie - "Heroes" (Live) [Official Video] [4K]',
    channel: 'David Bowie',
    verified: true,
    durationSec: 364,
    viewCount: 5_000_000,
  },
  {
    videoId: 'bowie-remaster',
    title: 'Heroes (2017 Remaster)',
    channel: 'David Bowie',
    verified: true,
    durationSec: 216,
    viewCount: 5_000_000,
  },
];

describe('pickBest — Bowie fixture (duration must not outrank provenance)', () => {
  const ctx: ScoreContext = { artist: 'David Bowie', title: 'Heroes', durationSec: 371 };

  it('picks the official studio video over the length-matching live video', () => {
    expect(pickBest(BOWIE_FIXTURE, ctx)?.videoId).toBe('bowie-studio');
  });

  it('ranks the studio video above the live one despite the worse duration match', () => {
    const studio = BOWIE_FIXTURE.find((c) => c.videoId === 'bowie-studio')!;
    const live = BOWIE_FIXTURE.find((c) => c.videoId === 'bowie-live')!;
    // The live cut is 7s off a 371s track; the studio video is 162s off.
    expect(scoreCandidate(studio, ctx)).toBeGreaterThan(scoreCandidate(live, ctx));
  });

  it('rejects the over-long unofficial re-uploads', () => {
    for (const id of ['bowie-reupload-long', 'bowie-christiane']) {
      const c = BOWIE_FIXTURE.find((x) => x.videoId === id)!;
      expect(scoreCandidate(c, ctx)).toBeLessThan(MIN_SCORE);
    }
  });

  it('clears the confidence threshold', () => {
    expect(scoreCandidate(BOWIE_FIXTURE[0], ctx)).toBeGreaterThanOrEqual(MIN_SCORE);
  });
});

describe('MIN_SCORE confidence gate', () => {
  it('blocks a song whose only artist upload is an Art Track', () => {
    const solangeCtx: ScoreContext = { artist: 'Solange', title: 'Weary', durationSec: 195 };
    for (const c of FIXTURE) {
      expect(scoreCandidate(c, solangeCtx)).toBeLessThan(MIN_SCORE);
    }
  });

  it('passes a genuine official video', () => {
    const ctx: ScoreContext = { artist: 'David Bowie', title: 'Heroes', durationSec: 371 };
    const studio = BOWIE_FIXTURE.find((c) => c.videoId === 'bowie-studio')!;
    expect(scoreCandidate(studio, ctx)).toBeGreaterThanOrEqual(MIN_SCORE);
  });
});

describe('explainCandidate', () => {
  const ctx: ScoreContext = { artist: 'Solange', title: 'Weary', durationSec: 195 };

  it('agrees with scoreCandidate', () => {
    for (const c of FIXTURE) {
      expect(explainCandidate(c, ctx).score).toBe(scoreCandidate(c, ctx));
    }
  });

  it('names the disqualifying reason for a rejected candidate', () => {
    const lyric = FIXTURE.find((c) => /LYRICS/i.test(c.title))!;
    const { reasons } = explainCandidate(lyric, ctx);
    expect(reasons.join(' | ')).toMatch(/lyric/i);
  });

  it('reports when there is no duration to compare', () => {
    const { reasons } = explainCandidate({ ...FIXTURE[0], durationSec: null }, ctx);
    expect(reasons.join(' | ')).toMatch(/no duration/i);
  });
});

describe('scoreCandidate — duration bands', () => {
  const base: Candidate = {
    videoId: 'x',
    title: 'Weary',
    channel: 'nobody',
    verified: false,
    durationSec: null,
    viewCount: null,
  };
  const ctx: ScoreContext = { durationSec: 200 };

  it('treats small deltas either side identically', () => {
    const a = scoreCandidate({ ...base, durationSec: 200 }, ctx);
    const b = scoreCandidate({ ...base, durationSec: 202 }, ctx);
    const c = scoreCandidate({ ...base, durationSec: 198 }, ctx);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('degrades as a candidate grows LONGER than the track', () => {
    const s5 = scoreCandidate({ ...base, durationSec: 205 }, ctx); // +5s   -> +20
    const s15 = scoreCandidate({ ...base, durationSec: 215 }, ctx); // +15s  -> +12
    const s45 = scoreCandidate({ ...base, durationSec: 245 }, ctx); // +45s  -> 0
    const s100 = scoreCandidate({ ...base, durationSec: 300 }, ctx); // +100s -> -30
    const s300 = scoreCandidate({ ...base, durationSec: 500 }, ctx); // +300s -> -45
    expect(s5).toBeGreaterThan(s15);
    expect(s15).toBeGreaterThan(s45);
    expect(s45).toBeGreaterThan(s100);
    expect(s100).toBeGreaterThan(s300);
  });

  it('is asymmetric: being shorter is treated far more kindly than being longer', () => {
    // Official videos are routinely single edits, so a short candidate must not
    // be punished the way a too-long medley or compilation is.
    const shorter = scoreCandidate({ ...base, durationSec: 200 - 100 }, ctx);
    const longer = scoreCandidate({ ...base, durationSec: 200 + 100 }, ctx);
    expect(shorter).toBeGreaterThan(longer);
  });

  it('penalizes a candidate under half the track length as a clip, not a song', () => {
    const clip = scoreCandidate({ ...base, durationSec: 60 }, ctx); // 30% of 200s
    const edit = scoreCandidate({ ...base, durationSec: 140 }, ctx); // 70% of 200s
    expect(clip).toBeLessThan(edit);
  });

  it('contributes nothing when either duration is missing', () => {
    const noCtxDuration = scoreCandidate({ ...base, durationSec: 200 }, {});
    const noCandidateDuration = scoreCandidate({ ...base, durationSec: null }, ctx);
    // Both fall back to whatever title/channel scoring alone yields — same for both.
    expect(noCtxDuration).toBe(noCandidateDuration);
  });
});

describe('scoreCandidate — channel signals', () => {
  const base: Candidate = {
    videoId: 'x',
    title: 'Some Song',
    channel: 'nobody',
    verified: false,
    durationSec: null,
    viewCount: null,
  };

  it('+25 when channel contains the normalized artist', () => {
    const matched = scoreCandidate({ ...base, channel: 'SolangeVEVO' }, { artist: 'Solange' });
    const unmatched = scoreCandidate({ ...base, channel: 'nobody' }, { artist: 'Solange' });
    expect(matched - unmatched).toBe(25);
  });

  it('+15 when verified', () => {
    const verified = scoreCandidate({ ...base, verified: true }, {});
    const unverified = scoreCandidate({ ...base, verified: false }, {});
    expect(verified - unverified).toBe(15);
  });

  it('guards against a short artist name causing false-positive containment', () => {
    // "Mo" (2 chars) would "match" almost any channel by naive containment.
    const withShortArtist = scoreCandidate({ ...base, channel: 'Motown Records' }, { artist: 'Mo' });
    const withoutArtist = scoreCandidate({ ...base, channel: 'Motown Records' }, {});
    expect(withShortArtist).toBe(withoutArtist);
  });
});

describe('scoreCandidate — title signals', () => {
  const base: Candidate = {
    videoId: 'x',
    title: 'placeholder',
    channel: 'nobody',
    verified: false,
    durationSec: null,
    viewCount: null,
  };

  it('+30 for "official video" / "official music video"', () => {
    const a = scoreCandidate({ ...base, title: 'Song Title (Official Video)' }, { title: 'Song Title' });
    const b = scoreCandidate({ ...base, title: 'Song Title (Official Music Video)' }, { title: 'Song Title' });
    const plain = scoreCandidate({ ...base, title: 'Song Title' }, { title: 'Song Title' });
    expect(a - plain).toBe(30);
    expect(b - plain).toBe(30);
  });

  it('-20 when the title does not contain the normalized track title', () => {
    const matches = scoreCandidate({ ...base, title: 'Weary' }, { title: 'Weary' });
    const mismatches = scoreCandidate({ ...base, title: 'Some Other Song' }, { title: 'Weary' });
    expect(matches - mismatches).toBe(20);
  });

  it('applies no title-containment penalty when ctx.title is absent', () => {
    const s = scoreCandidate({ ...base, title: 'Whatever' }, {});
    expect(s).toBe(0);
  });

  const penaltyCases: Array<[string, string, number]> = [
    ['karaoke', 'Weary (Karaoke Version)', -40],
    ['reaction', 'Weary REACTION', -40],
    ['live (word boundary)', 'Weary Live', -35],
    ['live at', 'Weary Live at the Apollo', -35],
    ['live from', 'Weary Live From Fallon', -35],
    ['cover', 'Weary Cover', -30],
    ['full album', 'Weary Full Album', -30],
    ['lyric', 'Weary Lyric Video', -25],
    ['lyrics', 'Weary Lyrics', -25],
    ['remix', 'Weary Remix', -25],
    ['sped up', 'Weary Sped Up', -25],
    ['slowed', 'Weary Slowed', -25],
    ['instrumental', 'Weary Instrumental', -20],
    ['audio', 'Weary Official Audio', -35],
  ];

  for (const [label, title, penalty] of penaltyCases) {
    it(`applies ${label} penalty (${penalty})`, () => {
      const withPenalty = scoreCandidate({ ...base, title }, { title: 'Weary' });
      const clean = scoreCandidate({ ...base, title: 'Weary' }, { title: 'Weary' });
      expect(withPenalty - clean).toBe(penalty);
    });
  }

  it('does not penalize "livery" or other substrings that merely contain "live"', () => {
    // \blive\b guards against this — "delivery" contains "live" but not as a word.
    const s = scoreCandidate({ ...base, title: 'Weary Delivery Service' }, { title: 'Weary' });
    const clean = scoreCandidate({ ...base, title: 'Weary' }, { title: 'Weary' });
    expect(s).toBe(clean);
  });
});

describe('scoreCandidate — popularity tiebreak', () => {
  const base: Candidate = {
    videoId: 'x',
    title: 'placeholder',
    channel: 'nobody',
    verified: false,
    durationSec: null,
    viewCount: null,
  };

  it('adds floor(log10(viewCount)) capped at 5', () => {
    expect(scoreCandidate({ ...base, viewCount: 1 }, {})).toBe(0);
    expect(scoreCandidate({ ...base, viewCount: 100 }, {})).toBe(2);
    expect(scoreCandidate({ ...base, viewCount: 1_000_000 }, {})).toBe(5);
    expect(scoreCandidate({ ...base, viewCount: 999_000_000 }, {})).toBe(5);
  });

  it('contributes 0 when viewCount is absent', () => {
    expect(scoreCandidate({ ...base, viewCount: null }, {})).toBe(0);
  });
});

describe('pickBest', () => {
  it('returns null only for an empty candidate list', () => {
    expect(pickBest([], { artist: 'x', title: 'y' })).toBeNull();
  });

  it('still returns a candidate when every candidate scores badly', () => {
    const terrible: Candidate[] = [
      { videoId: 'a', title: 'Totally Unrelated Karaoke Reaction', channel: 'random', verified: false, durationSec: 9999, viewCount: null },
      { videoId: 'b', title: 'Also Unrelated Cover Live', channel: 'other', verified: false, durationSec: 1, viewCount: null },
    ];
    const best = pickBest(terrible, { artist: 'Nope', title: 'Nothing Like It', durationSec: 200 });
    expect(best).not.toBeNull();
  });

  it('breaks ties using original search order (earlier wins)', () => {
    const tied: Candidate[] = [
      { videoId: 'first', title: 'identical', channel: 'c', verified: false, durationSec: null, viewCount: null },
      { videoId: 'second', title: 'identical', channel: 'c', verified: false, durationSec: null, viewCount: null },
    ];
    expect(pickBest(tied, {})?.videoId).toBe('first');
  });
});
