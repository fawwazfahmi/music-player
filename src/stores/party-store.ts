import { create } from "zustand";

export interface PartyView {
  id: string;
  active: boolean;
  startedBy: string;
  trackId: string | null;
  position: number;
  isPlaying: boolean;
  pulse: number;
  startedAt: string;
  ageMs: number;
}

interface PartyState {
  /** Server-side party state (broadcaster's view). Null when there's no
      active party that we know about. */
  remote: PartyView | null;
  /** True when *we* are currently following the party (hard-sync mode).
      Receiver-side only. */
  following: boolean;
  setRemote: (p: PartyView | null) => void;
  setFollowing: (v: boolean) => void;
}

export const usePartyStore = create<PartyState>((set) => ({
  remote: null,
  following: false,
  setRemote: (p) => set({ remote: p }),
  setFollowing: (v) => set({ following: v }),
}));
