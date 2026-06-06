"use client";

import { useIdentity } from "@/hooks/use-identity";
import { usePartyStore } from "@/stores/party-store";

// Hard-follow banner shown to fawwaz while he's in a listening party.
// 'Leave party' restores local control without ending the party for ainul.
export function PartyBanner() {
  const identity = useIdentity();
  const remote = usePartyStore((s) => s.remote);
  const following = usePartyStore((s) => s.following);
  const setFollowing = usePartyStore((s) => s.setFollowing);

  // Show a join CTA for fawwaz when an active party exists but he hasn't
  // joined yet. Show the live banner once following.
  if (identity !== "fawwaz") return null;
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
