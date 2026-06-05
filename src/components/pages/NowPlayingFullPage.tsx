"use client";

import { usePlayerStore } from "@/stores/player-store";
import { MusicNoteIcon } from "@/components/icons";

export function NowPlayingFullPage() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const videoLoading = usePlayerStore((s) => s.videoLoading);
  const track = queue[currentIndex] ?? null;

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
        ) : !track.ytVideoId ? (
          <div className="flex max-h-full max-w-full flex-col items-center gap-4">
            {track.coverArtHash ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/art/${track.coverArtHash}`}
                alt=""
                className="max-h-[60vh] max-w-full rounded-lg object-contain shadow-2xl ring-1 ring-zinc-800"
              />
            ) : (
              <div className="flex aspect-square h-[60vh] items-center justify-center rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-500">
                <MusicNoteIcon size={96} />
              </div>
            )}
            <p className="text-sm text-zinc-500">No video for this track</p>
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
