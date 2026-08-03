/**
 * Opt-in tracing for the music video pipeline, mirroring the `LOG_PUSHES=1`
 * convention in `api/ws.ts`.
 *
 * Turn on with `LOG_MUSICVIDEO=1` to follow a track from the scene push all
 * the way to bytes on the wire:
 *
 *   [musicvideo] skip widget=w1 reason=state entity=media_player.living_room state=idle
 *   [musicvideo] lookup start key="david bowie|heroes" query="David Bowie Heroes official music video"
 *   [musicvideo] lookup ok    key="david bowie|heroes" videoId=abc123 duration=214s in 3410ms
 *   [musicvideo] notify widget=w1 videoId=abc123
 *   [musicvideo] cache hit  key="david bowie|heroes" videoId=abc123
 *   [musicvideo] stream req videoId=abc123 range=none
 *   [musicvideo] stream ok  videoId=abc123 upstream=200 type=video/mp4
 *
 * Read once at module load, off by default — the pipeline is silent in normal
 * operation, so a scene left up for weeks doesn't fill a disk.
 */
const ENABLED = process.env.LOG_MUSICVIDEO === '1';

export function mvLog(message: string): void {
  if (ENABLED) console.log(`[musicvideo] ${message}`);
}

/** Failures worth surfacing even when tracing is off. */
export function mvWarn(message: string): void {
  console.error(`[musicvideo] ${message}`);
}

export function mvLogEnabled(): boolean {
  return ENABLED;
}
