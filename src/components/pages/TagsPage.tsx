"use client";

import { useEffect, useState } from "react";
import { getAllTags, type TagSummary } from "@/server/actions/tags";
import { useIpodStore } from "@/stores/ipod-store";
import { PageHeader, PageLoading } from "./_shared";

export function TagsPage() {
  const [tags, setTags] = useState<TagSummary[] | null>(null);
  const push = useIpodStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    void getAllTags().then((r) => {
      if (!cancelled) setTags(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Tags" subtitle="Library" />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tags === null ? (
          <PageLoading message="Loading tags…" />
        ) : tags.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">
            No tags yet — open a song&rsquo;s Notes view and add one (good for moods like
            &ldquo;late night&rdquo; or &ldquo;study&rdquo;).
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => push({ name: "tagDetail", tagId: t.id })}
                className="group flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
              >
                <span>{t.name}</span>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] tabular-nums text-zinc-400 group-hover:bg-emerald-500/20 group-hover:text-emerald-300">
                  {t.trackCount}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
