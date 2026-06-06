"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const NAMES = ["ainul", "fawwaz"] as const;
type Name = (typeof NAMES)[number];

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState<Name>("fawwaz");
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
      body: JSON.stringify({ name, password }),
    });
    setPending(false);
    if (!res.ok) {
      setError("Wrong password.");
      return;
    }
    router.replace("/");
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-zinc-950 px-4 text-zinc-100">
      {/* Ambient gradient backdrop — matches the player's accent palette without
          overpowering the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(800px circle at 20% 20%, rgba(16,185,129,0.18), transparent 60%), radial-gradient(700px circle at 85% 80%, rgba(99,102,241,0.14), transparent 55%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight">
            Music<span className="text-emerald-500">.</span>
          </h1>
          <p className="mt-2 text-sm text-zinc-500">A private universe of your favourite songs</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-zinc-800/70 bg-zinc-900/60 p-6 shadow-2xl backdrop-blur"
        >
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            You are
          </label>
          <div className="mt-2 mb-5 grid grid-cols-2 gap-2">
            {NAMES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setName(n)}
                className={
                  "rounded-lg border px-4 py-2 text-sm font-semibold capitalize transition " +
                  (name === n
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                    : "border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200")
                }
              >
                {n}
              </button>
            ))}
          </div>

          <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />

          {error && (
            <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || !password}
            className="mt-5 w-full rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Signing in…" : "Enter"}
          </button>

          <p className="mt-4 text-center text-[11px] text-zinc-600">
            Private instance · two-person access
          </p>
        </form>
      </div>
    </main>
  );
}
