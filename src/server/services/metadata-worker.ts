import { db } from "@/server/db";
import { searchRecording, getArtist, type RecordingResult } from "@/server/services/musicbrainz";
import { fetchCoverArt } from "@/server/services/cover-art";
import {
  parseYtTitle,
  aggressivelyCleanTitle,
  splitCamelCase,
} from "@/server/services/yt-title-parser";

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

  // Build a list of (artist, title) candidates to try, in order of preference.
  // Strategy 1: as-is (current artist + title).
  // Strategy 2: parsed from title (extracts "Artist - Title" pattern, strips tags).
  // Strategy 3: aggressively cleaned title with parsed artist (catches "(bridge demo)" etc).
  const strategies: Array<{ artist: string; title: string; label: string }> = [
    { artist: track.primaryArtist.name, title: track.title, label: "as-is" },
  ];
  const parsed = parseYtTitle(track.title, track.primaryArtist.name);
  if (parsed.artist !== track.primaryArtist.name || parsed.title !== track.title) {
    strategies.push({ artist: parsed.artist, title: parsed.title, label: "parsed" });
  }
  const aggressive = aggressivelyCleanTitle(track.title);
  if (aggressive !== parsed.title && aggressive.length > 0) {
    strategies.push({ artist: parsed.artist, title: aggressive, label: "aggressive" });
  }
  // CamelCase split for artists like "BillieEilish" → "Billie Eilish".
  // Try with both the aggressive title (if available) and the parsed title.
  const splitArtist = splitCamelCase(parsed.artist);
  if (splitArtist !== parsed.artist) {
    const splitTitle = aggressive.length > 0 ? aggressive : parsed.title;
    strategies.push({ artist: splitArtist, title: splitTitle, label: "camelcase-split" });
  }

  let top: RecordingResult | null = null;
  let strategyUsed = "";
  for (const s of strategies) {
    const candidates = await searchRecording(s.artist, s.title);
    if (candidates.length === 0) continue;
    const t = candidates[0]!;
    const second = candidates[1]?.score ?? 0;
    const acceptable = t.score >= 95 || (t.score >= 85 && t.score - second >= 10);
    if (acceptable) {
      top = t;
      strategyUsed = s.label;
      break;
    }
  }

  if (!top) {
    // None of the strategies returned a confident match — mark as fetched
    // (with no MBID) so we don't keep retrying. User can manually fix via
    // the (future) Needs Review screen.
    await db.track.update({
      where: { id: trackId },
      data: { metadataFetched: new Date() },
    });
    throw new Error(`weak-match: no strategy produced a confident match`);
  }

  console.log(`[mu] enriched "${track.title}" via ${strategyUsed} → "${top.title}" by "${top.artistName}"`);

  // If MB's artist name differs from our current artist row, re-link the
  // track to the correct Artist (upsert by name; old artist row may be
  // orphaned but we leave it for now — safer than auto-delete).
  let primaryArtistId = track.primaryArtistId;
  if (top.artistMbid && top.artistName && top.artistName !== track.primaryArtist.name) {
    const correctArtist = await db.artist.upsert({
      where: { name: top.artistName },
      create: {
        name: top.artistName,
        mbid: top.artistMbid,
        discoveredAt: track.primaryArtist.discoveredAt ?? new Date(),
      },
      update: { mbid: top.artistMbid },
    });
    primaryArtistId = correctArtist.id;
  }

  // Update Track with MBID + refined title + re-linked artist
  await db.track.update({
    where: { id: trackId },
    data: {
      mbid: top.mbid,
      title: top.title,
      primaryArtistId,
      metadataFetched: new Date(),
    },
  });

  // Update Artist (bio) if MBID known and not already fetched
  if (top.artistMbid) {
    const targetArtist = await db.artist.findUnique({ where: { id: primaryArtistId } });
    if (targetArtist && !targetArtist.bio) {
      try {
        const info = await getArtist(top.artistMbid);
        await db.artist.update({
          where: { id: primaryArtistId },
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
