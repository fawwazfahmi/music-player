import { db } from "@/server/db";
import { searchRecording, getArtist } from "@/server/services/musicbrainz";
import { fetchCoverArt } from "@/server/services/cover-art";

let running = false;
let stop = false;
const POLL_INTERVAL_MS = 5000;

export function startMetadataWorker(): void {
  if (running) return;
  running = true;
  stop = false;
  void loop();
}

export function stopMetadataWorker(): void {
  stop = true;
}

async function loop(): Promise<void> {
  while (!stop) {
    let job;
    try {
      job = await db.metadataJob.findFirst({
        where: { status: "QUEUED" },
        orderBy: { createdAt: "asc" },
      });
    } catch (err) {
      // DB may be unreachable on early boot — back off
      console.error("[mu] metadata worker: db error", err);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    await db.metadataJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", attempts: { increment: 1 } },
    });

    try {
      if (job.trackId) {
        await processTrackJob(job.trackId);
      }
      await db.metadataJob.update({
        where: { id: job.id },
        data: { status: "DONE", completedAt: new Date() },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.metadataJob.update({
        where: { id: job.id },
        data: { status: "FAILED", lastError: msg.slice(0, 500) },
      });
    }
  }
  running = false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function processTrackJob(trackId: string): Promise<void> {
  const track = await db.track.findUnique({
    where: { id: trackId },
    include: { primaryArtist: true, album: true },
  });
  if (!track) return;

  const candidates = await searchRecording(track.primaryArtist.name, track.title);
  if (candidates.length === 0) {
    await db.track.update({
      where: { id: trackId },
      data: { metadataFetched: new Date() },
    });
    return;
  }

  const top = candidates[0]!;
  const strongCount = candidates.filter((c) => c.score >= 70).length;
  if (top.score < 85 || strongCount > 1) {
    throw new Error(`multi-match: top=${top.score}, ${strongCount} candidates >=70`);
  }

  // Update Track with MBID + refined title
  await db.track.update({
    where: { id: trackId },
    data: {
      mbid: top.mbid,
      title: top.title,
      metadataFetched: new Date(),
    },
  });

  // Update Artist if MBID known and not already fetched
  if (top.artistMbid) {
    const existing = await db.artist.findUnique({ where: { id: track.primaryArtistId } });
    if (existing && !existing.mbid) {
      try {
        const info = await getArtist(top.artistMbid);
        await db.artist.update({
          where: { id: track.primaryArtistId },
          data: {
            mbid: top.artistMbid,
            name: info.name,
            bio: info.bio ?? null,
            metadataFetched: new Date(),
          },
        });
      } catch (err) {
        console.warn("[mu] artist enrich failed:", err);
      }
    }
  }

  // Update Album + fetch cover art
  if (top.releaseMbid && track.albumId) {
    const album = await db.album.findUnique({ where: { id: track.albumId } });
    if (album && !album.coverArtHash) {
      await db.album.update({
        where: { id: track.albumId },
        data: {
          mbid: top.releaseMbid,
          title: top.releaseTitle ?? album.title,
        },
      });
      try {
        const art = await fetchCoverArt(top.releaseMbid);
        if (art) {
          await db.album.update({
            where: { id: track.albumId },
            data: {
              coverArtPath: art.path,
              coverArtHash: art.hash,
              metadataFetched: new Date(),
            },
          });
        }
      } catch (err) {
        console.warn("[mu] cover art fetch failed:", err);
      }
    }
  }
}
