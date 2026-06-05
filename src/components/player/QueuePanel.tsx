"use client";

import { usePlayerStore } from "@/stores/player-store";
import { CloseIcon, PlayIcon } from "@/components/icons";
import { formatDuration } from "@/lib/format-duration";

export function QueuePanel() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  if (queue.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Queue is empty
      </div>
    );
  }

  // Split into "now playing" / "up next" so the user always sees what's
  // playing at the top and what's coming next below.
  const playing = queue[currentIndex];
  const upNext = queue.slice(currentIndex + 1);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3 scrollbar-thin scrollbar-thumb-zinc-700">
      {playing && (
        <>
          <h3 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Now playing
          </h3>
          <QueueRow
            index={currentIndex}
            title={playing.title}
            artist={playing.artist}
            duration={playing.duration}
            coverArtHash={playing.coverArtHash ?? null}
            active
            playing={isPlaying}
          />
        </>
      )}

      <h3 className="mt-4 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Up next ({upNext.length})
      </h3>
      {upNext.length === 0 ? (
        <p className="px-1 py-3 text-xs text-zinc-600">Nothing queued.</p>
      ) : (
        upNext.map((t, i) => (
          <QueueRow
            key={`${currentIndex + 1 + i}-${t.id}`}
            index={currentIndex + 1 + i}
            title={t.title}
            artist={t.artist}
            duration={t.duration}
            coverArtHash={t.coverArtHash ?? null}
          />
        ))
      )}
    </div>
  );
}

function QueueRow({
  index,
  title,
  artist,
  duration,
  coverArtHash,
  active,
  playing,
}: {
  index: number;
  title: string;
  artist: string;
  duration: number;
  coverArtHash: string | null;
  active?: boolean;
  playing?: boolean;
}) {
  const jumpToIndex = usePlayerStore((s) => s.jumpToIndex);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => jumpToIndex(index)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          jumpToIndex(index);
        }
      }}
      className={
        "group flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 transition hover:bg-zinc-800/60 " +
        (active ? "bg-zinc-800/40 text-emerald-400" : "")
      }
    >
      {coverArtHash ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/art/${coverArtHash}`}
          alt=""
          className="h-9 w-9 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded bg-gradient-to-br from-zinc-700 to-zinc-900" />
      )}
      <div className="min-w-0 flex-1">
        <div
          className={
            "flex items-center gap-1 truncate text-sm font-medium " +
            (active ? "" : "text-zinc-100")
          }
        >
          {active && playing && <PlayIcon size={12} />}
          <span className="truncate">{title}</span>
        </div>
        <div className="truncate text-xs text-zinc-500">{artist}</div>
      </div>
      <span className="hidden text-[10px] tabular-nums text-zinc-600 group-hover:hidden md:inline">
        {formatDuration(duration)}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          removeFromQueue(index);
        }}
        aria-label="Remove from queue"
        title="Remove from queue"
        className="rounded-full p-1 text-zinc-500 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-700/60 hover:text-zinc-100"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
