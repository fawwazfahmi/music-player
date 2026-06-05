"use client";

import { useState } from "react";
import { backfillMetadata, rescanLibrary } from "@/server/actions/library";
import { LogoutIcon } from "@/components/icons";
import { PageHeader } from "./_shared";

export function SettingsPage() {
  const [busy, setBusy] = useState<string | null>(null);
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
