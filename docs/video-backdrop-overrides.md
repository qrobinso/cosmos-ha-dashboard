# Video backdrop overrides

The Video Backdrop widget picks a YouTube video automatically for whatever song is playing. It's
deliberately strict about what counts as a match (see the "Video backdrop widget" section of the
app's `DOCS.md`), which means some songs — even ones with a well-known official video — show
nothing, because the automatic matcher won't gamble on a fan re-upload or a lyric video. The
**Video Backdrop** admin page (`/admin/musicvideo`) is where you fix that by hand, for individual
songs.

## Watching a player

At the top of the page, pick the `media_player` entity you want Cosmos to watch. This is
independent of any scene's widget — it's just what the page itself uses to know what's playing
right now, so it can show you the current track's status and let you act on it directly.

## Pinning a specific video

With something playing:

1. The "Now playing" card shows the current artist/title and how it currently resolves
   (auto-matched, nothing found, pinned, or blocked).
2. Paste a YouTube link — a `youtube.com/watch`, `youtu.be`, `music.youtube.com`, or Shorts
   link all work — into the field and click **Save**.
3. Cosmos checks that the video is actually playable before saving. If it's private, removed,
   age-restricted, or region-locked, you'll get an error and nothing is saved.

Once saved, that song always plays the pinned video — the automatic matcher is skipped
entirely for it, on every display, from then on. **A pin is permanent until you remove it**;
there's no expiry or re-check.

You can also pin from history: the **Recent** section lists the last 50 songs Cosmos tried to
resolve automatically, including misses. Click **Pin** on any row to prefill the form with that
song, then paste a link and save.

### Finding an older song

Fifty songs go by quickly, and the one you want to fix is often further back. Use the search box
in **Recent** — it looks across *every* song Cosmos remembers, not just the fifty on screen, and
matches on artist or title. Songs resolved before this feature shipped have no stored artist and
title, so they show as `artist|title`; searching still finds them.

Clear the box to return to the recent list.

## Blocking a song

Some songs you'd rather the widget just stay hidden for, even if a video does exist — a video
that doesn't suit the mood, for instance. Click **Never play** (on the current track) or
**Block** (on a Recent row) instead of pasting a link. No video is required. Like a pin, a
block is permanent until removed — the widget will simply show nothing for that song.

## Managing existing overrides

The **Overrides** section lists every song you've pinned or blocked. From there you can:

- **Edit** — reopens the song in the form above so you can paste a different link.
- **Remove** — deletes the override entirely, returning that song to automatic matching.
