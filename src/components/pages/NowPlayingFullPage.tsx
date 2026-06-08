"use client";

import { usePlayerStore } from "@/stores/player-store";
import { MusicNoteIcon } from "@/components/icons";
import { coverUrl } from "@/lib/cover-url";

export function NowPlayingFullPage() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const videoLoading = usePlayerStore((s) => s.videoLoading);
  const performanceMode = usePlayerStore((s) => s.performanceMode);
  const track = queue[currentIndex] ?? null;
  // In performance mode (no YT iframe), treat YT tracks like local tracks —
  // render the cover art tile instead of the video slot div.
  const showVideoTile = !!track?.ytVideoId && !performanceMode;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800/50 px-6 py-4">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Now Playing</p>
        <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-zinc-100">
          {track?.title ?? "Nothing playing"}
        </h1>
        <p className="truncate text-sm text-zinc-400">{track?.artist}</p>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
        {!track ? (
          <div className="flex flex-col items-center gap-3 text-zinc-500">
            <MusicNoteIcon size={48} />
            <p className="text-sm">Pick a song to see it here.</p>
          </div>
        ) : !showVideoTile ? (
          <div className="flex max-h-full max-w-full flex-col items-center gap-4">
            {(() => {
              const url = coverUrl(track.coverArtHash, track.ytVideoId);
              return url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt=""
                  className="max-h-[60vh] max-w-full rounded-lg object-contain shadow-2xl ring-1 ring-zinc-800"
                />
              ) : (
                <div className="flex aspect-square h-[60vh] items-center justify-center rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-500">
                  <MusicNoteIcon size={96} />
                </div>
              );
            })()}
            <p className="text-sm text-zinc-500">
              {performanceMode
                ? "Performance mode — video hidden"
                : "No video for this track"}
            </p>
          </div>
        ) : (
          // This div is the slot the global VideoStage will overlay onto.
          <div
            data-video-slot="big"
            className="relative aspect-video max-h-full w-full max-w-[1280px] overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-zinc-800"
            style={{ width: "min(100%, 1280px, calc((100dvh - 15rem) * 16 / 9))" }}
          >
            {videoLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 text-sm text-zinc-300">
                Loading video…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
