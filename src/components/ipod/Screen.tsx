"use client";

import { useIpodStore } from "@/stores/ipod-store";
import { HomeMenu } from "./screens/HomeMenu";
import { MusicSub } from "./screens/MusicSub";
import { ArtistList } from "./screens/ArtistList";
import { AlbumList } from "./screens/AlbumList";
import { SongList } from "./screens/SongList";
import { NowPlaying } from "./screens/NowPlaying";

export function Screen() {
  const current = useIpodStore((s) => s.current());
  switch (current.name) {
    case "home":
      return <HomeMenu />;
    case "musicSub":
      return <MusicSub />;
    case "artistList":
      return <ArtistList />;
    case "albumList":
      return <AlbumList />;
    case "songList":
      return <SongList />;
    case "nowPlaying":
      return <NowPlaying />;
    default:
      return null;
  }
}
