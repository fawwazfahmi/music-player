import { create } from "zustand";
import type { QueueTrack } from "@/stores/player-store";

export interface DownloadJob {
  /** The YouTube videoId. Polled against /api/yt-status/[ytVideoId]. */
  id: string;
  title: string;
  artist: string;
  /** Wall-clock ms when this job started; used by DownloadIndicator's
      fake-progress animation. */
  startedAt: number;
  /** Track row id; the API route returns it immediately so we know what
      to queue once the download lands. */
  trackId: string;
  /** Pre-built queue track to plug into the player once the file is ready.
      Carries the title / artist / coverArtHash / ytVideoId we already know
      client-side from the YT search result — avoids a round-trip to refetch
      the track row at completion time. */
  queueTrack: QueueTrack;
  /** Error message if the download failed. UI surfaces this then auto-clears. */
  error?: string;
}

interface DownloadState {
  active: DownloadJob | null;
  /** Begin tracking a job. Subscribers (AppShell's polling effect) react to
      this and call /api/yt-status until the file is ready. */
  start: (job: Omit<DownloadJob, "startedAt">) => void;
  /** Mark complete and clear. Called by the polling effect on READY. */
  finish: () => void;
  /** Mark failed and surface the error. Clears `active` so the UI dismisses. */
  fail: (message: string) => void;
}

export const useDownloadStore = create<DownloadState>((set) => ({
  active: null,
  start: (job) => set({ active: { ...job, startedAt: Date.now() } }),
  finish: () => set({ active: null }),
  fail: (message) =>
    set((s) => (s.active ? { active: { ...s.active, error: message } } : s)),
}));
