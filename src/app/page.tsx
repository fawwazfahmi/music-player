import { Ipod } from "@/components/ipod/Ipod";
import { PlayerBar } from "@/components/player/PlayerBar";
import { LyricsPanel } from "@/components/player/LyricsPanel";
import { YtVideoPanel } from "@/components/player/YtVideoPanel";

export default function Home() {
  return (
    <main className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      {/* Bento grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 md:grid-cols-[320px_minmax(0,1fr)_minmax(280px,360px)]">
        {/* iPod tile */}
        <section className="flex items-center justify-center rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-zinc-800/70">
          <Ipod />
        </section>

        {/* YT video tile */}
        <section className="overflow-hidden rounded-2xl bg-black ring-1 ring-zinc-800/70">
          <YtVideoPanel />
        </section>

        {/* Lyrics tile */}
        <section className="min-h-0 overflow-hidden rounded-2xl bg-zinc-900/50 ring-1 ring-zinc-800/70">
          <div className="flex h-full flex-col">
            <div className="border-b border-zinc-800/70 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Lyrics
            </div>
            <div className="min-h-0 flex-1">
              <LyricsPanel />
            </div>
          </div>
        </section>
      </div>

      {/* Player bar — full width bottom */}
      <PlayerBar />
    </main>
  );
}
