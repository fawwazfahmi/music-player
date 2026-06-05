"use client";

import { useIpodStore } from "@/stores/ipod-store";
import { HomePage } from "./HomePage";
import { SongsPage } from "./SongsPage";
import { ArtistsPage } from "./ArtistsPage";
import { ArtistDetailPage } from "./ArtistDetailPage";
import { AlbumsPage } from "./AlbumsPage";
import { AlbumDetailPage } from "./AlbumDetailPage";
import { FavoritesPage } from "./FavoritesPage";
import { PlaylistDetailPage } from "./PlaylistDetailPage";
import { NewPlaylistPage } from "./NewPlaylistPage";
import { SearchPage } from "./SearchPage";
import { SettingsPage } from "./SettingsPage";
import { YtPickerPage } from "./YtPickerPage";
import { NotesPage } from "./NotesPage";
import { NowPlayingFullPage } from "./NowPlayingFullPage";
import { StatsPage } from "./StatsPage";

export function MainContent() {
  const current = useIpodStore((s) => s.current());

  switch (current.name) {
    case "home":
      return <HomePage />;
    case "search":
      return <SearchPage />;
    case "ytPicker":
      return <YtPickerPage query={current.query} />;
    case "songList":
      return <SongsPage />;
    case "artistList":
      return <ArtistsPage />;
    case "artistDetail":
      return <ArtistDetailPage artistId={current.artistId} />;
    case "albumList":
      return <AlbumsPage />;
    case "albumDetail":
      return <AlbumDetailPage albumId={current.albumId} />;
    case "favoritesList":
      return <FavoritesPage />;
    case "playlistList":
      return <SettingsPage />; // playlist list is in the sidebar; this is a fallback
    case "playlistDetail":
      return <PlaylistDetailPage playlistId={current.playlistId} />;
    case "newPlaylist":
      return <NewPlaylistPage />;
    case "settings":
      return <SettingsPage />;
    case "notes":
      return <NotesPage trackId={current.trackId} />;
    case "nowPlayingFull":
      return <NowPlayingFullPage />;
    case "stats":
      return <StatsPage />;
    case "nowPlaying":
      return <HomePage />; // now playing is the right panel; main shows home
    case "musicSub":
      return <HomePage />; // legacy state, redirect home
    default:
      return <HomePage />;
  }
}
