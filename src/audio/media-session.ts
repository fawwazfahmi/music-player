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
    artwork: track.coverArtHash
      ? [{ src: `/api/art/${track.coverArtHash}`, sizes: "500x500", type: "image/jpeg" }]
      : [],
  });
}
