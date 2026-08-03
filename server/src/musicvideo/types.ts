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
 * The seam that keeps yt-dlp swappable. `ytdlp.ts` is one implementation;
 * a YouTube Data API v3 client would be another, with no other file changing.
 *
 * Neither method ever throws — every failure resolves to null.
 */
export interface VideoLookup {
  /** Search for a video and resolve its stream in one call. */
  search(query: string): Promise<ResolvedVideo | null>;
  /** Re-derive a fresh stream URL for a known videoId. */
  streamUrlFor(videoId: string): Promise<string | null>;
}
