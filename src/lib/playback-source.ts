import type { PlaybackSource, TrackSource } from "@prisma/client";

/**
 * Map how a track is stored to how it was played.
 *
 * `startPlay` used to hardcode LOCAL_FILE for every play, which made
 * PlaybackSource dead data: three enum values, one ever written, so
 * "streamed vs cached" could never be reported on.
 *
 * Lives here rather than in playback.ts because that file is "use server",
 * and every export from a server-action module has to be an async function —
 * which would make this untestable in isolation.
 */
export function playbackSourceFor(trackSource: TrackSource): PlaybackSource {
  switch (trackSource) {
    case "YT_CACHED":
      return "YT_CACHED";
    case "YT_STREAMING":
      return "YT_STREAM";
    // LOCAL_SCAN and UPLOAD are both a file on our own disk.
    case "LOCAL_SCAN":
    case "UPLOAD":
    default:
      return "LOCAL_FILE";
  }
}
