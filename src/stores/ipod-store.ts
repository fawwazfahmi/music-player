import { create } from "zustand";

export type ScreenState =
  | { name: "home" }
  | { name: "musicSub" }
  | { name: "artistList" }
  | { name: "artistDetail"; artistId: string }
  | { name: "albumList" }
  | { name: "albumDetail"; albumId: string }
  | { name: "songList" }
  | { name: "nowPlaying" }
  | { name: "search" }
  | { name: "ytPicker"; query: string }
  | { name: "settings" }
  | { name: "playlistList" }
  | { name: "playlistDetail"; playlistId: string }
  | { name: "newPlaylist" };

export function screenKey(s: ScreenState): string {
  switch (s.name) {
    case "artistDetail":
      return `artistDetail:${s.artistId}`;
    case "albumDetail":
      return `albumDetail:${s.albumId}`;
    case "ytPicker":
      return `ytPicker:${s.query}`;
    case "playlistDetail":
      return `playlistDetail:${s.playlistId}`;
    default:
      return s.name;
  }
}

interface IpodState {
  navStack: ScreenState[];
  selectionByScreen: Record<string, number>;
  current: () => ScreenState;
  push: (screen: ScreenState) => void;
  pop: () => void;
  toRoot: () => void;
  getSelectionFor: (s: ScreenState) => number;
  setSelectionFor: (s: ScreenState, idx: number) => void;
}

export const useIpodStore = create<IpodState>((set, get) => ({
  navStack: [{ name: "home" }],
  selectionByScreen: {},
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
  getSelectionFor: (s) => get().selectionByScreen[screenKey(s)] ?? 0,
  setSelectionFor: (s, idx) =>
    set((state) => ({
      selectionByScreen: { ...state.selectionByScreen, [screenKey(s)]: idx },
    })),
}));
