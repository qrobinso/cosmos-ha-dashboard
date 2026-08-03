import { describe, it, expect } from 'vitest';
import { scoreCandidate, pickBest, type Candidate, type ScoreContext } from '../src/musicvideo/score.js';

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

describe('scoreCandidate / pickBest — real fixture', () => {
  it('picks #2 ("Weary" by solangeknowlesmusic) as the winner', () => {
    const winner = pickBest(FIXTURE, CTX);
    expect(winner?.videoId).toBe('row2-weary');
  });

  it('scores every candidate (documented for audit)', () => {
    const scores = FIXTURE.map((c) => ({ id: c.videoId, score: scoreCandidate(c, CTX) }));
    // #2 must clearly beat everything else.
    const byId = Object.fromEntries(scores.map((s) => [s.id, s.score]));
    expect(byId['row2-weary']).toBeGreaterThan(byId['row1-medley']);
    expect(byId['row2-weary']).toBeGreaterThan(byId['row3-lyrics']);
    expect(byId['row2-weary']).toBeGreaterThan(byId['row5-remix']);
    expect(byId['row2-weary']).toBeGreaterThan(byId['row6-visual']);
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

  it('<=2s delta scores the max duration bonus', () => {
    const a = scoreCandidate({ ...base, durationSec: 200 }, ctx);
    const b = scoreCandidate({ ...base, durationSec: 202 }, ctx);
    const c = scoreCandidate({ ...base, durationSec: 198 }, ctx);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('is monotonically non-increasing as delta grows through the bands', () => {
    const s2 = scoreCandidate({ ...base, durationSec: 202 }, ctx); // delta 2 -> +50
    const s5 = scoreCandidate({ ...base, durationSec: 205 }, ctx); // delta 5 -> +35
    const s15 = scoreCandidate({ ...base, durationSec: 215 }, ctx); // delta 15 -> +10
    const s45 = scoreCandidate({ ...base, durationSec: 245 }, ctx); // delta 45 -> 0
    const sBig = scoreCandidate({ ...base, durationSec: 300 }, ctx); // delta 100 -> -40
    expect(s2).toBeGreaterThan(s5);
    expect(s5).toBeGreaterThan(s15);
    expect(s15).toBeGreaterThan(s45);
    expect(s45).toBeGreaterThan(sBig);
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

  it('+15 for "official video" / "official music video"', () => {
    const a = scoreCandidate({ ...base, title: 'Song Title (Official Video)' }, { title: 'Song Title' });
    const b = scoreCandidate({ ...base, title: 'Song Title (Official Music Video)' }, { title: 'Song Title' });
    const plain = scoreCandidate({ ...base, title: 'Song Title' }, { title: 'Song Title' });
    expect(a - plain).toBe(15);
    expect(b - plain).toBe(15);
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
    ['live (word boundary)', 'Weary Live', -30],
    ['live at', 'Weary Live at the Apollo', -30],
    ['live from', 'Weary Live From Fallon', -30],
    ['cover', 'Weary Cover', -30],
    ['full album', 'Weary Full Album', -30],
    ['lyric', 'Weary Lyric Video', -25],
    ['lyrics', 'Weary Lyrics', -25],
    ['remix', 'Weary Remix', -25],
    ['sped up', 'Weary Sped Up', -25],
    ['slowed', 'Weary Slowed', -25],
    ['instrumental', 'Weary Instrumental', -20],
    ['audio', 'Weary Official Audio', -10],
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
