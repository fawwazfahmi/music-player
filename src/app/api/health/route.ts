import { NextResponse } from "next/server";
import { db } from "@/server/db";

// Lightweight health check for uptime monitoring (Cloudflare, UptimeRobot).
// Returns 200 + status payload when the app + DB are reachable, 503 if the
// DB ping fails. Auth-gated by middleware below the PUBLIC_PATHS list — see
// proxy.ts for the exemption.

export async function GET() {
  const t0 = Date.now();
  let dbOk = false;
  let dbErr: string | null = null;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (e) {
    dbErr = e instanceof Error ? e.message.slice(0, 200) : String(e);
  }
  const status = dbOk ? 200 : 503;
  return NextResponse.json(
    {
      ok: dbOk,
      db: dbOk ? "ok" : "fail",
      dbError: dbErr,
      uptimeSec: Math.round(process.uptime()),
      latencyMs: Date.now() - t0,
      version: process.env.npm_package_version ?? "unknown",
    },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}
