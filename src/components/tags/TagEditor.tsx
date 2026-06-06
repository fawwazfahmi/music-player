"use client";

import { useEffect, useRef, useState } from "react";
import {
  addTagToTrack,
  getAllTags,
  getTagsForTrack,
  removeTagFromTrack,
  type TagSummary,
} from "@/server/actions/tags";
import { CloseIcon } from "@/components/icons";

interface Props {
  trackId: string;
}

export function TagEditor({ trackId }: Props) {
  const [tags, setTags] = useState<TagSummary[] | null>(null);
  const [allTags, setAllTags] = useState<TagSummary[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getTagsForTrack(trackId), getAllTags()]).then(([cur, all]) => {
      if (cancelled) return;
      setTags(cur);
      setAllTags(all);
    });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  async function add(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    const added = await addTagToTrack(trackId, trimmed);
    if (added) {
      setTags((prev) => {
        if (!prev) return [added];
        if (prev.some((t) => t.id === added.id)) return prev;
        return [...prev, added].sort((a, b) => a.name.localeCompare(b.name));
      });
      // Optimistically include in autocomplete options too.
      setAllTags((prev) =>
        prev.some((t) => t.id === added.id)
          ? prev
          : [...prev, { ...added, trackCount: (added.trackCount ?? 0) + 1 }].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
      );
    }
    setInput("");
    setBusy(false);
    inputRef.current?.focus();
  }

  async function remove(tagId: string) {
    setBusy(true);
    await removeTagFromTrack(trackId, tagId);
    setTags((prev) => (prev ? prev.filter((t) => t.id !== tagId) : prev));
    setBusy(false);
  }

  const currentIds = new Set((tags ?? []).map((t) => t.id));
  const lowerInput = input.toLowerCase();
  const suggestions = allTags
    .filter(
      (t) =>
        !currentIds.has(t.id) &&
        (lowerInput === "" || t.name.includes(lowerInput)),
    )
    .slice(0, 8);

  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Tags</h3>
        <span className="text-[10px] text-zinc-600">
          Useful for moods · &ldquo;late night&rdquo;, &ldquo;study&rdquo;, &ldquo;road trip&rdquo;
        </span>
      </div>

      {tags === null ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {tags.length === 0 && (
            <span className="text-xs text-zinc-600">No tags yet — add one below.</span>
          )}
          {tags.map((t) => (
            <span
              key={t.id}
              className="group flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300"
            >
              {t.name}
              <button
                type="button"
                onClick={() => remove(t.id)}
                disabled={busy}
                aria-label={`Remove tag ${t.name}`}
                className="ml-1 rounded-full p-0.5 text-emerald-300/60 transition hover:bg-emerald-500/20 hover:text-emerald-200"
              >
                <CloseIcon size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add(input);
        }}
        className="flex flex-col gap-2"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add a tag…"
          disabled={busy}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
        />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => add(s.name)}
                disabled={busy}
                className="rounded-full border border-zinc-700/70 px-2 py-0.5 text-[11px] text-zinc-300 transition hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-300"
              >
                {s.name}
                <span className="ml-1 text-zinc-500">·</span>
                <span className="ml-1 text-zinc-500">{s.trackCount}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
