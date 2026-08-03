/** Config stored on a `musicvideo` widget. */
export interface MusicVideoConfig {
  /** Required. The `media_player.*` entity this widget follows. */
  entity_id: string;
  /** Appended to the search query. Defaults to "official music video". */
  query_suffix?: string;
}

/** A successful lookup: the video plus a directly-playable stream URL. */
export interface ResolvedVideo {
  videoId: string;
  streamUrl: string;
  /** Seconds. 0 when yt-dlp did not report one. */
  duration: number;
  title: string;
}

/**
 * Outcome of a search. The three cases are deliberately distinct because the
 * resolver treats them differently:
 *
 * - `ok`          — found it. Cache the id and the stream url.
 * - `none`        — the lookup RAN and found nothing. Safe to negative-cache.
 * - `unavailable` — the lookup COULD NOT RUN (yt-dlp missing, spawn refused).
 *                   Must NOT be negative-cached: otherwise every track played
 *                   before the user installs yt-dlp stays poisoned for 24h
 *                   afterwards.
 */
export type VideoSearchResult =
  | { status: 'ok'; video: ResolvedVideo }
  | { status: 'none' }
  | { status: 'unavailable' };

/**
 * Optional context passed alongside the search query so the lookup can score
 * candidates instead of blindly taking YouTube's first hit. All fields
 * optional — a caller with no HA metadata still gets a (less confident)
 * result.
 */
export type SearchHint = {
  artist?: string;
  title?: string;
  /** HA's `media_duration` for the currently playing track. */
  durationSec?: number;
};

/**
 * The seam that keeps yt-dlp swappable. `ytdlp.ts` is one implementation;
 * a YouTube Data API v3 client would be another, with no other file changing.
 *
 * Neither method ever throws — every failure resolves to a value.
 */
export interface VideoLookup {
  /** Search for a video and resolve its stream in one call. `hint` lets the
   * implementation score candidates rather than take the first search hit. */
  search(query: string, hint?: SearchHint): Promise<VideoSearchResult>;
  /** Re-derive a fresh stream URL for a known videoId. */
  streamUrlFor(videoId: string): Promise<string | null>;
}
