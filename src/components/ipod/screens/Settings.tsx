"use client";

import { useEffect, useState } from "react";
import { rescanLibrary, backfillMetadata } from "@/server/actions/library";

interface SettingsProps {
  selected?: number;
}

const items = [
  { label: "Rescan Library" },
  { label: "Backfill Metadata" },
  { label: "Logout" },
];

export function Settings({ selected = 0 }: SettingsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ipod-row-count", { detail: { count: items.length } }));
  }, []);

  useEffect(() => {
    function handler(e: Event) {
      const idx = (e as CustomEvent<{ selected: number }>).detail.selected;
      if (idx === 0) {
        setBusy("Scanning...");
        setReport(null);
        void rescanLibrary()
          .then((r) =>
            setReport(`+${r.added} added, ${r.skippedDuplicates} dupes, ${r.errors.length} errors`),
          )
          .catch((e: unknown) =>
            setReport(`Error: ${e instanceof Error ? e.message : String(e)}`),
          )
          .finally(() => setBusy(null));
      } else if (idx === 1) {
        setBusy("Enqueuing...");
        setReport(null);
        void backfillMetadata()
          .then((r) => setReport(`Enqueued ${r.enqueued} track(s) for enrichment`))
          .catch((e: unknown) =>
            setReport(`Error: ${e instanceof Error ? e.message : String(e)}`),
          )
          .finally(() => setBusy(null));
      } else if (idx === 2) {
        void fetch("/api/logout", { method: "POST" }).then(() => location.replace("/login"));
      }
    }
    window.addEventListener("ipod-select", handler as EventListener);
    return () => window.removeEventListener("ipod-select", handler as EventListener);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-gradient-to-b from-[#b9c6dc] to-[#5f7aa6] px-2 py-1 text-center text-[10px] font-bold text-white">
        Settings
      </div>
      <ul>
        {items.map((it, i) => (
          <li
            key={it.label}
            className={
              "flex items-center justify-between border-b border-black/5 px-2 py-1 " +
              (i === selected
                ? "bg-gradient-to-b from-[#6a9af0] to-[#2a55b8] font-semibold text-white"
                : "")
            }
          >
            <span>{it.label}</span>
            <span>›</span>
          </li>
        ))}
      </ul>
      {(busy || report) && (
        <div className="px-2 py-2 text-center text-[10px] text-zinc-700">
          {busy ?? report}
        </div>
      )}
    </div>
  );
}
