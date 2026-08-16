import { create } from "zustand";

/** Session-scoped memory of which ephemeral picks the listener has already
    decided on, so the adopt nudge doesn't re-ask. Not persisted — a fresh
    session may ask again. */
interface AdoptState {
  dismissed: Set<string>;
  adopted: Set<string>;
  dismiss: (trackId: string) => void;
  markAdopted: (trackId: string) => void;
}

export const useAdoptStore = create<AdoptState>((set) => ({
  dismissed: new Set(),
  adopted: new Set(),
  dismiss: (trackId) =>
    set((s) => ({ dismissed: new Set(s.dismissed).add(trackId) })),
  markAdopted: (trackId) =>
    set((s) => ({ adopted: new Set(s.adopted).add(trackId) })),
}));
