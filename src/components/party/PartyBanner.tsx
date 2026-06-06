"use client";

import { useIdentity } from "@/hooks/use-identity";
import { usePartyStore } from "@/stores/party-store";

// Top-of-app banner for both sides of a listening party:
//   ainul (broadcaster):
//     - hidden when no active party
//     - shows the live roster of followers once the party is live
//   fawwaz (receiver):
//     - shows a Join CTA when ainul has an active party but he isn't
//       following yet
//     - shows the 'Listening with ainul' state + Leave button while
//       following
export function PartyBanner() {
  const identity = useIdentity();
  const remote = usePartyStore((s) => s.remote);
  const following = usePartyStore((s) => s.following);
  const setFollowing = usePartyStore((s) => s.setFollowing);

  // No identity → no banner. Avoids a flash before useIdentity hydrates.
  if (!identity) return null;

  // ainul branch — only show while she has an active party of her own.
  if (identity === "ainul") {
    if (!remote?.active || remote.startedBy !== "ainul") return null;
    const others = remote.followers.filter((f) => f !== "ainul");
    return (
      <div className="flex items-center justify-between gap-3 border-b border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400"
            aria-hidden
          />
          <span className="text-zinc-100">
            {others.length === 0 ? (
              <>Listening party live — waiting for fawwaz…</>
            ) : (
              <>
                Listening with{" "}
                {others.map((n, i) => (
                  <span key={n} className="font-semibold capitalize">
                    {n}
                    {i < others.length - 1 ? ", " : ""}
                  </span>
                ))}
              </>
            )}
          </span>
        </div>
      </div>
    );
  }

  // fawwaz branch — Join CTA + follow banner.
  if (!remote?.active && !following) return null;

  if (!following && remote?.active) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400"
            aria-hidden
          />
          <span className="text-zinc-100">
            <span className="font-semibold capitalize">{remote.startedBy}</span> started a
            listening party
          </span>
        </div>
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400"
        >
          Join
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400"
          aria-hidden
        />
        <span className="text-zinc-100">
          Listening with <span className="font-semibold capitalize">{remote?.startedBy ?? "ainul"}</span>
          {!remote?.active && " · party ended"}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setFollowing(false)}
        className="rounded-full border border-emerald-500/50 px-3 py-1 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
      >
        Leave party
      </button>
    </div>
  );
}
