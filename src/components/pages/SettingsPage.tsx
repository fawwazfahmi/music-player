"use client";

import { useEffect, useRef, useState } from "react";
import { backfillMetadata, rescanLibrary } from "@/server/actions/library";
import { LogoutIcon } from "@/components/icons";
import { PageHeader } from "./_shared";
import { PatchNotesDialog } from "@/components/player/PatchNotesDialog";
import { PATCH_NOTES } from "@/lib/patch-notes";

type CookieStatus = "none" | "connected" | "stale";

/**
 * "Connect YouTube" — upload a cookies.txt so Mixes resolve as *your*
 * YouTube instead of an anonymous cold-start radio.
 *
 * Deliberately blunt about what this file is. It holds live Google session
 * credentials that can't be scoped to YouTube alone, and mu_name is an
 * unsigned cookie, so this is a convenience boundary between the two of you,
 * not a security one.
 */
function YouTubeCookiesSection() {
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Initial status load. Subsequent changes come straight from the upload /
  // disconnect responses, so there's nothing to re-poll.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/yt-cookies", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { name: string; status: CookieStatus };
        if (cancelled) return;
        setStatus(j.status);
        setName(j.name);
      } catch {
        /* cosmetic — the section just stays in its unknown state */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/yt-cookies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookies: text }),
      });
      const j = (await res.json().catch(() => null)) as
        | { status?: CookieStatus; message?: string; error?: string }
        | null;
      if (!res.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`);
      setStatus(j?.status ?? "connected");
      setMessage("Connected. Mixes will now resolve as your YouTube account.");
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/yt-cookies", { method: "DELETE" });
      setStatus("none");
      setMessage("Disconnected. Mixes will resolve anonymously again.");
    } finally {
      setBusy(false);
    }
  }

  const badge =
    status === "connected"
      ? { text: "Connected", cls: "bg-emerald-500/15 text-emerald-300" }
      : status === "stale"
        ? { text: "Expired — reconnect", cls: "bg-amber-500/15 text-amber-300" }
        : { text: "Not connected", cls: "bg-zinc-800 text-zinc-400" };

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">
          Connect YouTube{name ? ` · ${name}` : ""}
        </h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
          {badge.text}
        </span>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        A YouTube Mix is personalized by your logged-in session, not by the link — the link only
        names the seed song. Without cookies the server fetches a generic version of the mix.
        Export a <code className="text-zinc-400">cookies.txt</code> with a browser extension like
        &ldquo;Get cookies.txt LOCALLY&rdquo; while signed in to YouTube, then upload it here.
      </p>
      <p className="mt-2 text-xs text-amber-500/80">
        Heads up: that file holds live Google account credentials and can&apos;t be limited to
        YouTube alone. Consider using a throwaway Google account. Sessions expire on their own, so
        you&apos;ll need to re-upload now and then.
      </p>
      {status === "stale" && (
        <p className="mt-2 text-xs text-amber-400">
          The saved cookies stopped working, so mixes are falling back to anonymous. Re-export and
          upload to fix it.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
          className="text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-950 hover:file:bg-white"
        />
        {status !== "none" && status !== null && (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40"
          >
            Disconnect
          </button>
        )}
      </div>
      {message && <p className="mt-2 text-xs text-zinc-400">{message}</p>}
    </section>
  );
}

export function SettingsPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  async function rescan() {
    setBusy("Scanning…");
    setReport(null);
    try {
      const r = await rescanLibrary();
      setReport(`+${r.added} added · ${r.skippedDuplicates} dupes · ${r.errors.length} errors`);
    } catch (e: unknown) {
      setReport(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function backfill() {
    setBusy("Enqueuing…");
    setReport(null);
    try {
      const r = await backfillMetadata();
      setReport(`Enqueued ${r.enqueued} track(s) for enrichment`);
    } catch (e: unknown) {
      setReport(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    location.replace("/login");
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" subtitle="Account & Library" />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-xl space-y-4">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-semibold text-zinc-100">What&apos;s new</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Release notes for Kyowave. These pop up once when there&apos;s an update;
              open them here any time, or if you cleared your browser storage.
            </p>
            <button
              type="button"
              onClick={() => setNotesOpen(true)}
              className="mt-3 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800"
            >
              View patch notes
            </button>
          </section>
          <PatchNotesDialog
            open={notesOpen}
            releases={PATCH_NOTES}
            onClose={() => setNotesOpen(false)}
          />
          <YouTubeCookiesSection />
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-semibold text-zinc-100">Library</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Scan your MUSIC_LIBRARY_PATH for new audio files and enrich existing tracks.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={rescan}
                disabled={!!busy}
                className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-white disabled:opacity-40"
              >
                Rescan Library
              </button>
              <button
                type="button"
                onClick={backfill}
                disabled={!!busy}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40"
              >
                Backfill Metadata
              </button>
            </div>
            {(busy || report) && (
              <p className="mt-3 text-xs text-zinc-400">{busy ?? report}</p>
            )}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-semibold text-zinc-100">Session</h3>
            <button
              type="button"
              onClick={logout}
              className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
            >
              <LogoutIcon size={16} /> Logout
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
