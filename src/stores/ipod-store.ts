import { create } from "zustand";

export type ScreenState =
  | { name: "home" }
  | { name: "musicSub" }
  | { name: "artistList" }
  | { name: "artistDetail"; artistId: string }
  | { name: "albumList" }
  | { name: "albumDetail"; albumId: string }
  | { name: "songList" }
  | { name: "nowPlaying" };

interface IpodState {
  navStack: ScreenState[];
  current: () => ScreenState;
  push: (screen: ScreenState) => void;
  pop: () => void;
  toRoot: () => void;
}

export const useIpodStore = create<IpodState>((set, get) => ({
  navStack: [{ name: "home" }],
  current: () => {
    const stack = get().navStack;
    return stack[stack.length - 1] ?? { name: "home" };
  },
  push: (screen) => set((s) => ({ navStack: [...s.navStack, screen] })),
  pop: () =>
    set((s) => {
      if (s.navStack.length <= 1) return s;
      return { navStack: s.navStack.slice(0, -1) };
    }),
  toRoot: () => set({ navStack: [{ name: "home" }] }),
}));
