"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 text-zinc-100">
      <form
        onSubmit={onSubmit}
        className="w-72 rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
      >
        <h1 className="mb-4 text-center text-lg font-light tracking-tight">Music Universe</h1>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={pending || !password}
          className="mt-4 w-full rounded bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 transition disabled:opacity-40"
        >
          {pending ? "…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
