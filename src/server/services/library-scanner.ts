import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import chokidar, { type FSWatcher } from "chokidar";
import { db } from "@/server/db";
import { readTrackMetadata } from "@/server/services/id3-reader";

const AUDIO_EXTS = new Set([".m4a", ".mp3", ".flac", ".opus", ".ogg", ".wav"]);

export interface ScanReport {
  added: number;
  skippedDuplicates: number;
  errors: { path: string; reason: string }[];
}

async function sha256(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

export async function ingestFile(filePath: string): Promise<"added" | "duplicate" | "error"> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return "error";
    const sha = await sha256(filePath);
    const existing = await db.track.findUnique({ where: { sha256: sha } });
    if (existing) return "duplicate";

    const meta = await readTrackMetadata(filePath);
    const artist = await db.artist.upsert({
      where: { name: meta.artistName },
      create: { name: meta.artistName, discoveredAt: new Date() },
      update: {},
    });
    const album = await db.album.upsert({
      where: { artistId_title: { artistId: artist.id, title: meta.albumTitle } },
      create: { title: meta.albumTitle, artistId: artist.id },
      update: {},
    });
    await db.track.create({
      data: {
        title: meta.title,
        duration: meta.durationSec,
        trackNumber: meta.trackNumber,
        discNumber: meta.discNumber,
        filePath,
        fileSize: BigInt(stats.size),
        fileFormat: meta.fileFormat,
        bitrate: meta.bitrate,
        sha256: sha,
        primaryArtistId: artist.id,
        albumId: album.id,
        source: "LOCAL_SCAN",
        discoveredAt: new Date(),
      },
    });
    return "added";
  } catch {
    return "error";
  }
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    // Skip dot-prefixed entries (.cache, .DS_Store, etc) to match the chokidar
    // watcher's ignore pattern. Keeps the scanner from re-ingesting YT cached
    // m4a files as if they were a separate local library.
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

export async function scanOnce(rootPath: string): Promise<ScanReport> {
  const files = await walk(rootPath);
  const report: ScanReport = { added: 0, skippedDuplicates: 0, errors: [] };
  for (const file of files) {
    const result = await ingestFile(file);
    if (result === "added") report.added++;
    else if (result === "duplicate") report.skippedDuplicates++;
    else report.errors.push({ path: file, reason: "ingest_failed" });
  }
  return report;
}

let activeWatcher: FSWatcher | null = null;

export function startWatcher(rootPath: string): FSWatcher {
  if (activeWatcher) return activeWatcher;
  const watcher = chokidar.watch(rootPath, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 1500 },
  });
  watcher
    .on("add", (filePath) => {
      if (AUDIO_EXTS.has(path.extname(filePath).toLowerCase())) {
        ingestFile(filePath).catch(() => {});
      }
    })
    .on("unlink", async (filePath) => {
      await db.track.updateMany({ where: { filePath }, data: { playable: false } });
    });
  activeWatcher = watcher;
  return watcher;
}

export async function stopWatcher(): Promise<void> {
  if (activeWatcher) {
    await activeWatcher.close();
    activeWatcher = null;
  }
}
