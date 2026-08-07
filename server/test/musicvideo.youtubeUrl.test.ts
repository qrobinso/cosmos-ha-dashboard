import { describe, it, expect } from 'vitest';
import { parseYouTubeId } from '../src/musicvideo/youtubeUrl.js';

describe('parseYouTubeId', () => {
  const ID = 'dQw4w9WgXcQ';

  it.each([
    ['plain watch URL', `https://www.youtube.com/watch?v=${ID}`],
    ['no www', `https://youtube.com/watch?v=${ID}`],
    ['http', `http://www.youtube.com/watch?v=${ID}`],
    ['protocol-relative', `//www.youtube.com/watch?v=${ID}`],
    ['no protocol', `www.youtube.com/watch?v=${ID}`],
    ['with timestamp', `https://www.youtube.com/watch?v=${ID}&t=42s`],
    ['with playlist', `https://www.youtube.com/watch?v=${ID}&list=PLabc&index=2`],
    ['v not first param', `https://www.youtube.com/watch?list=PLabc&v=${ID}`],
    ['short link', `https://youtu.be/${ID}`],
    ['short link with si', `https://youtu.be/${ID}?si=AbCdEf123`],
    ['short link with t', `https://youtu.be/${ID}?t=30`],
    ['youtube music', `https://music.youtube.com/watch?v=${ID}`],
    ['music with si', `https://music.youtube.com/watch?v=${ID}&si=xyz`],
    ['shorts', `https://www.youtube.com/shorts/${ID}`],
    ['shorts with query', `https://www.youtube.com/shorts/${ID}?feature=share`],
    ['embed', `https://www.youtube.com/embed/${ID}`],
    ['mobile', `https://m.youtube.com/watch?v=${ID}`],
    ['bare id', ID],
    ['surrounding whitespace', `  https://youtu.be/${ID}  `],
  ])('parses %s', (_label, input) => {
    expect(parseYouTubeId(input)).toBe(ID);
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['not a URL at all', 'hello world'],
    ['a different site', 'https://vimeo.com/12345678'],
    ['youtube homepage', 'https://www.youtube.com/'],
    ['channel page', 'https://www.youtube.com/@SomeArtist'],
    ['watch with no v param', 'https://www.youtube.com/watch?list=PLabc'],
    ['id too short', 'abc123'],
    ['id too long', 'dQw4w9WgXcQextra'],
    ['id with illegal chars', 'dQw4w9WgX!Q'],
  ])('rejects %s', (_label, input) => {
    expect(parseYouTubeId(input)).toBeNull();
  });

  it('does not mistake a lookalike host for youtube', () => {
    expect(parseYouTubeId(`https://notyoutube.com/watch?v=${ID}`)).toBeNull();
    expect(parseYouTubeId(`https://youtube.com.evil.example/watch?v=${ID}`)).toBeNull();
  });
});
