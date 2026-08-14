"use client";

import { useEffect, useState } from "react";
import {
  clearTrackCover,
  listCoverCandidates,
  setTrackCover,
} from "@/server/actions/cover";
import type { CoverCandidate } from "@/server/services/cover-candidates";

interface Props {
  open: boolean;
  trackId: string;
  trackTitle: string;
  onClose: () => void;
  /** Fired after the cover changes, so the caller can refresh its art. */
  onChanged?: (hash: string | null) => void;
}

/**
 * Pick a replacement cover for one track.
 *
 * The kebab menu is far too narrow for an image grid, so this is a modal in
 * the same shape as KeyboardHelpDialog. Thumbnails load straight from the
 * remote hosts — Cover Art Archive 404s constantly for releases with no
 * uploaded art, so tiles that fail to load remove themselves.
 */
export function CoverPickerDialog({
  open,
  trackId,
  trackTitle,
  onClose,
  onChanged,
}: Props) {
  const [candidates, setCandidates] = useState<CoverCandidate[] | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      try {
        const list = await listCoverCandidates(trackId);
        if (!cancelled) setCandidates(list);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, trackId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function choose(c: CoverCandidate) {
    setBusy(c.id);
    setError(null);
    try {
      const { hash } = await setTrackCover(trackId, c.fullUrl);
      onChanged?.(hash);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    setError(null);
    try {
      await clearTrackCover(trackId);
      onChanged?.(null);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const visible = (candidates ?? []).filter((c) => !broken.has(c.id));

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Change cover"
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
              Change cover
            </h2>
            <p className="truncate text-xs text-zinc-500">{trackTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            Esc
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          {error && (
            <p className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-200">
              {error}
            </p>
          )}

          {candidates === null ? (
            <p className="py-10 text-center text-sm text-zinc-500">
              Looking for covers…
            </p>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-zinc-400">No cover art found for this track.</p>
              <p className="mt-1 text-xs text-zinc-600">
                MusicBrainz has nothing for this artist and title, and there&apos;s no
                YouTube thumbnail to fall back on.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {visible.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void choose(c)}
                  className={
                    "group overflow-hidden rounded-lg border text-left transition disabled:opacity-50 " +
                    (c.isCurrent
                      ? "border-sky-500/60"
                      : "border-zinc-800 hover:border-zinc-600")
                  }
                >
                  <div className="relative aspect-square bg-zinc-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.thumbUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={() =>
                        setBroken((prev) => new Set(prev).add(c.id))
                      }
                    />
                    {busy === c.id && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-zinc-200">
                        Saving…
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="truncate text-[11px] text-zinc-300">{c.label}</div>
                    {c.note && (
                      <div className="truncate text-[10px] text-amber-500/70">{c.note}</div>
                    )}
                    {c.isCurrent && (
                      <div className="text-[10px] text-sky-400">In use</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <p className="text-[11px] text-zinc-600">
            Applies to this song only, not the whole album.
          </p>
          <button
            type="button"
            onClick={() => void reset()}
            disabled={busy !== null}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-40"
          >
            {busy === "reset" ? "Resetting…" : "Reset to default"}
          </button>
        </div>
      </div>
    </div>
  );
}
