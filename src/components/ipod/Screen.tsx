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
import { Settings } from "./screens/Settings";
import { ArtistDetail } from "./screens/ArtistDetail";
import { AlbumDetail } from "./screens/AlbumDetail";
import { PlaylistList } from "./screens/PlaylistList";
import { PlaylistDetail } from "./screens/PlaylistDetail";
import { NewPlaylist } from "./screens/NewPlaylist";
import { FavoritesList } from "./screens/FavoritesList";
import { Notes } from "./screens/Notes";

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
    case "settings":
      return <Settings selected={selected} />;
    case "artistDetail":
      return <ArtistDetail artistId={current.artistId} selected={selected} />;
    case "albumDetail":
      return <AlbumDetail albumId={current.albumId} selected={selected} />;
    case "playlistList":
      return <PlaylistList selected={selected} />;
    case "playlistDetail":
      return <PlaylistDetail playlistId={current.playlistId} selected={selected} />;
    case "newPlaylist":
      return <NewPlaylist />;
    case "favoritesList":
      return <FavoritesList selected={selected} />;
    case "notes":
      return <Notes trackId={current.trackId} />;
    default:
      return null;
  }
}
