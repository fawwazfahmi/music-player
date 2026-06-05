import { NextResponse } from "next/server";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

const ART_DIR = path.join(env.MUSIC_LIBRARY_PATH, ".cache", "art");
const HASH_RE = /^[a-f0-9]{64}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;
  if (!HASH_RE.test(hash)) {
    return NextResponse.json({ error: "bad_hash" }, { status: 400 });
  }
  const filePath = path.join(ART_DIR, `${hash}.jpg`);
  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const data = await readFile(filePath);
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
