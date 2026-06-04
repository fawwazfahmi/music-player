"use client";

import { useIpodStore } from "@/stores/ipod-store";
import { HomeMenu } from "./screens/HomeMenu";
import { MusicSub } from "./screens/MusicSub";
import { ArtistList } from "./screens/ArtistList";
import { AlbumList } from "./screens/AlbumList";
import { SongList } from "./screens/SongList";
import { NowPlaying } from "./screens/NowPlaying";
import { Search } from "./screens/Search";
import { YtPicker } from "./screens/YtPicker";

export interface ScreenProps {
  selected: number;
}

export function Screen({ selected }: ScreenProps) {
  const current = useIpodStore((s) => s.current());
  switch (current.name) {
    case "home":
      return <HomeMenu selected={selected} />;
    case "musicSub":
      return <MusicSub selected={selected} />;
    case "artistList":
      return <ArtistList selected={selected} />;
    case "albumList":
      return <AlbumList selected={selected} />;
    case "songList":
      return <SongList selected={selected} />;
    case "nowPlaying":
      return <NowPlaying />;
    case "search":
      return <Search selected={selected} />;
    case "ytPicker":
      return <YtPicker query={current.query} selected={selected} />;
    default:
      return null;
  }
}
