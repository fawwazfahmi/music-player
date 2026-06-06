"use client";

import { useState } from "react";
import { useIdentity } from "@/hooks/use-identity";
import { usePartyStore } from "@/stores/party-store";
import { usePlayerStore } from "@/stores/player-store";
import { getEngine } from "@/audio/engine";

// Visible only to ainul. Sidebar entry that starts / ends the listening
// party. When active, the button turns into 'End party'.
export function PartyButton() {
  const identity = useIdentity();
  const remote = usePartyStore((s) => s.remote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (identity !== "ainul") return null;

  const active = !!remote?.active;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const player = usePlayerStore.getState();
      const t = player.queue[player.currentIndex] ?? null;
      const res = await fetch("/api/party", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trackId: t?.id ?? null,
          trackTitle: t?.title ?? null,
          trackArtist: t?.artist ?? null,
          position: getEngine().getCurrentTime(),
          isPlaying: player.isPlaying,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!remote) return;
    setBusy(true);
    try {
      await fetch(`/api/party?id=${encodeURIComponent(remote.id)}`, { method: "DELETE" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-3 pb-1">
      <button
        type="button"
        onClick={() => (active ? end() : start())}
        disabled={busy}
        className={
          "flex w-full items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition disabled:opacity-50 " +
          (active
            ? "bg-red-500/15 text-red-300 hover:bg-red-500/25"
            : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25")
        }
      >
        <span>{active ? "End listening party" : "Start listening party"}</span>
        {active && (
          <span
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-400"
            aria-hidden
          />
        )}
      </button>
      {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
