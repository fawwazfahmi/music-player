import type { QueueTrack } from "@/stores/player-store";

export interface MediaSessionActions {
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeekTo: (seconds: number) => void;
}

export function bindMediaSession(actions: MediaSessionActions): () => void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return () => {};
  }
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", actions.onPlay);
  ms.setActionHandler("pause", actions.onPause);
  ms.setActionHandler("previoustrack", actions.onPrev);
  ms.setActionHandler("nexttrack", actions.onNext);
  ms.setActionHandler("seekto", (e) => {
    if (typeof e.seekTime === "number") actions.onSeekTo(e.seekTime);
  });
  return () => {
    ms.setActionHandler("play", null);
    ms.setActionHandler("pause", null);
    ms.setActionHandler("previoustrack", null);
    ms.setActionHandler("nexttrack", null);
    ms.setActionHandler("seekto", null);
  };
}

/**
 * Artwork for the lock screen, Dynamic Island and Control Center.
 *
 * This used to return `[]` for any track without a stored hash, which is most
 * of the YouTube library — so the app showed the video thumbnail everywhere in
 * its own UI (via `coverUrl`) while the lock screen showed a blank grey square.
 * The fallback below is the same one the UI already uses.
 *
 * Sizes are declared only where they are genuinely different images. Stored art
 * is a single file at one resolution, so it gets one entry; YouTube publishes
 * real distinct renditions, so both are offered and the platform picks. Listing
 * one URL three times under three sizes would just be a lie that costs a
 * download.
 */
export function mediaArtworkFor(track: QueueTrack): MediaImage[] {
  if (track.coverArtHash) {
    // Cover Art Archive images are fetched at front-500.
    return [{ src: `/api/art/${track.coverArtHash}`, sizes: "500x500", type: "image/jpeg" }];
  }
  if (track.ytVideoId) {
    return [
      {
        src: `https://i.ytimg.com/vi/${track.ytVideoId}/mqdefault.jpg`,
        sizes: "320x180",
        type: "image/jpeg",
      },
      {
        src: `https://i.ytimg.com/vi/${track.ytVideoId}/hqdefault.jpg`,
        sizes: "480x360",
        type: "image/jpeg",
      },
    ];
  }
  return [];
}

export function updateMediaMetadata(track: QueueTrack | null): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: mediaArtworkFor(track),
  });
}

/**
 * Tell the OS whether we're playing, so the lock screen shows the right button.
 *
 * Without this the platform infers state from the audio element, which is
 * usually right but drifts whenever playback is gated in app code — exactly
 * what the video gate used to do.
 */
export function setMediaPlaybackState(playing: boolean): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  } catch {
    /* older engines don't have the setter */
  }
}

/**
 * Drive the lock-screen / Dynamic Island scrubber.
 *
 * `setPositionState` throws a TypeError if position exceeds duration, which
 * happens transiently on every track change: the new track's duration lands
 * before the audio element has reset its currentTime. Clamping is what makes
 * this safe to call from a timeupdate handler; the try/catch is the belt.
 */
export function updateMediaPositionState(
  position: number,
  duration: number,
  playbackRate = 1,
): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  if (typeof ms.setPositionState !== "function") return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  if (!Number.isFinite(position)) return;
  try {
    ms.setPositionState({
      duration,
      position: Math.max(0, Math.min(position, duration)),
      playbackRate: playbackRate > 0 ? playbackRate : 1,
    });
  } catch {
    /* nothing actionable — the scrubber just won't track this tick */
  }
}

/** Clear the scrubber, e.g. when the queue empties. */
export function clearMediaPositionState(): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  if (typeof ms.setPositionState !== "function") return;
  try {
    ms.setPositionState();
  } catch {
    /* ignore */
  }
}
