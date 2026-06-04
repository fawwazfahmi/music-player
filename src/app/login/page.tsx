"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Chassis } from "@/components/ipod/Chassis";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setPending(false);
    if (!res.ok) {
      setError("Wrong password.");
      return;
    }
    router.replace("/");
  }

  const screen = (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        iPod
      </div>
      <form onSubmit={onSubmit} className="flex flex-1 flex-col items-center justify-center gap-2 p-3">
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded border border-black/30 bg-white/60 px-2 py-1 text-[11px] text-black outline-none focus:bg-white"
        />
        {error && <p className="text-[9px] text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={pending || !password}
          className="w-full rounded bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
        >
          {pending ? "…" : "Enter"}
        </button>
      </form>
    </div>
  );

  const fakeWheel = (
    <div className="mx-auto h-[220px] w-[220px] rounded-full bg-gradient-to-b from-zinc-100 to-zinc-300 opacity-40" />
  );

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 p-4">
      <Chassis screen={screen} wheel={fakeWheel} />
    </main>
  );
}
