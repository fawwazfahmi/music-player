import { create } from "zustand";

export interface DownloadJob {
  id: string; // ytVideoId or any unique key
  title: string;
  artist: string;
  startedAt: number;
}

interface DownloadState {
  active: DownloadJob | null;
  start: (job: Omit<DownloadJob, "startedAt">) => void;
  finish: () => void;
}

export const useDownloadStore = create<DownloadState>((set) => ({
  active: null,
  start: (job) => set({ active: { ...job, startedAt: Date.now() } }),
  finish: () => set({ active: null }),
}));
