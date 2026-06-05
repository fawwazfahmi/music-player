import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "@/lib/env";

const ART_DIR_NAME = path.join(".cache", "art");

function artDir(): string {
  return path.join(env.MUSIC_LIBRARY_PATH, ART_DIR_NAME);
}

export interface CoverArtResult {
  path: string;
  hash: string;
  mimeType: string;
}

export async function fetchCoverArt(releaseMbid: string): Promise<CoverArtResult | null> {
  const url = `https://coverartarchive.org/release/${releaseMbid}/front-500`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CAA ${res.status}: ${url}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const dir = artDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${hash}.jpg`);
  await fs.writeFile(filePath, buf);
  return { path: filePath, hash, mimeType: "image/jpeg" };
}
