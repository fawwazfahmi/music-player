import { NextResponse } from "next/server";
import { getYtStatus } from "@/server/services/yt-download";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ytVideoId: string }> },
) {
  const { ytVideoId } = await params;
  if (!ytVideoId) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  const status = await getYtStatus(ytVideoId);
  return NextResponse.json(status, {
    headers: { "cache-control": "no-store" },
  });
}
