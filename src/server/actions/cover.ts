"use server";

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import {
  buildCoverCandidates,
  isAllowedCoverHost,
  type CoverCandidate,
} from "@/server/services/cover-candidates";

const ART_DIR = path.join(env.MUSIC_LIBRARY_PATH, ".cache", "art");

/** A front-500 cover is tens of KB. Anything past a few MB is not a cover,
    and we are writing this to disk from a remote host. */
const MAX_COVER_BYTES = 8 * 1024 * 1024;

export async function listCoverCandidates(trackId: string): Promise<CoverCandidate[]> {
  const track = await db.track.findUnique({
    where: { id: trackId },
    select: {
      title: true,
      ytVideoId: true,
      coverArtHash: true,
      primaryArtist: { select: { name: true } },
      album: { select: { coverArtHash: true } },
    },
  });
  if (!track) throw new Error("Track not found");

  return buildCoverCandidates({
    artistName: track.primaryArtist?.name ?? "",
    title: track.title,
    ytVideoId: track.ytVideoId,
    currentHash: track.coverArtHash ?? track.album?.coverArtHash ?? null,
  });
}

export interface SetTrackCoverResult {
  hash: string;
}

/**
 * Download the chosen image, store it by content hash, and point the track at
 * it. Stored in the same `.cache/art/<sha256>.jpg` layout the MusicBrainz
 * path already uses, so /api/art/<hash> and its immutable caching apply
 * unchanged.
 */
export async function setTrackCover(
  trackId: string,
  imageUrl: string,
): Promise<SetTrackCoverResult> {
  // Already-stored art: the user re-picked the current cover. Nothing to
  // fetch — just point the track at that hash.
  const localMatch = /^\/api\/art\/([a-f0-9]{64})$/.exec(imageUrl);
  if (localMatch) {
    const hash = localMatch[1]!;
    await db.track.update({ where: { id: trackId }, data: { coverArtHash: hash } });
    return { hash };
  }

  if (!isAllowedCoverHost(imageUrl)) {
    throw new Error("That image host isn't allowed");
  }

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Couldn't fetch that image (HTTP ${res.status})`);

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("That URL didn't return an image");
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error("That image was empty");
  if (buf.byteLength > MAX_COVER_BYTES) throw new Error("That image is too large");

  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  await fs.mkdir(ART_DIR, { recursive: true });
  await fs.writeFile(path.join(ART_DIR, `${hash}.jpg`), buf);

  await db.track.update({ where: { id: trackId }, data: { coverArtHash: hash } });
  return { hash };
}

/** Drop the override so the track falls back to album art, then YouTube. */
export async function clearTrackCover(trackId: string): Promise<void> {
  await db.track.update({ where: { id: trackId }, data: { coverArtHash: null } });
}
