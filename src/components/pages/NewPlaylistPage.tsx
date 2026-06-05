"use client";

import { useState, type FormEvent } from "react";
import { createPlaylist } from "@/server/actions/playlists";
import { useIpodStore } from "@/stores/ipod-store";

export function NewPlaylistPage() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const toRoot = useIpodStore((s) => s.toRoot);
  const push = useIpodStore((s) => s.push);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const { id } = await createPlaylist(n);
      toRoot();
      push({ name: "playlistDetail", playlistId: id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
      >
        <h2 className="text-xl font-bold text-zinc-100">New playlist</h2>
        <p className="mt-1 text-sm text-zinc-500">Give your playlist a name.</p>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My new mix"
          className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => toRoot()}
            className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40"
          >
            {busy ? "..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
