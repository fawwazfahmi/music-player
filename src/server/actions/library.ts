"use server";

import { db } from "@/server/db";
import { env } from "@/lib/env";
import { scanOnce, type ScanReport } from "@/server/services/library-scanner";

export async function rescanLibrary(): Promise<ScanReport> {
  return scanOnce(env.MUSIC_LIBRARY_PATH);
}

export async function backfillMetadata(): Promise<{ enqueued: number }> {
  const pendingTrackIds = new Set(
    (
      await db.metadataJob.findMany({
        where: { status: { in: ["QUEUED", "RUNNING"] }, trackId: { not: null } },
        select: { trackId: true },
      })
    )
      .map((j) => j.trackId)
      .filter((id): id is string => id !== null),
  );
  const tracks = await db.track.findMany({
    where: { metadataFetched: null },
    select: { id: true },
  });
  const toEnqueue = tracks.filter((t) => !pendingTrackIds.has(t.id));
  if (toEnqueue.length === 0) return { enqueued: 0 };
  await db.metadataJob.createMany({
    data: toEnqueue.map((t) => ({ entityType: "TRACK" as const, trackId: t.id, status: "QUEUED" as const })),
  });
  return { enqueued: toEnqueue.length };
}
