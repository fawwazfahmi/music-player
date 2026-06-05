"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPlaylist } from "@/server/actions/playlists";
import { useIpodStore } from "@/stores/ipod-store";

export function NewPlaylist() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const push = useIpodStore((s) => s.push);
  const pop = useIpodStore((s) => s.pop);

  useEffect(() => {
    inputRef.current?.focus();
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: 0 } }));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const { id } = await createPlaylist(n);
      pop(); // back to playlistList
      push({ name: "playlistDetail", playlistId: id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        New Playlist
      </div>
      <form onSubmit={onSubmit} className="flex flex-1 flex-col items-center justify-center gap-2 p-3">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name..."
          className="w-full rounded border border-black/20 bg-white/80 px-1 py-0.5 text-[11px] text-black outline-none"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="w-full rounded bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "..." : "Create"}
        </button>
        <p className="text-[9px] text-zinc-700">Menu to cancel</p>
      </form>
    </div>
  );
}
