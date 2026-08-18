// Weekly download-health check. Runs one REAL yt-dlp audio download and, if it
// fails (almost always a fresh YouTube player-client gating → HTTP 403), fires a
// macOS notification so you re-pin a working client before you notice missing
// songs. Green runs are silent except for the log line.
//
// On demand:   pnpm exec tsx --env-file=.env scripts/health-check-download.ts
// Scheduled:   deploy/launchd/com.kyowave.health-download.plist (Mondays 09:00)
import { spawn } from "node:child_process";
import { db } from "@/server/db";
import {
  runDownloadProbe,
  interpretProbe,
  FALLBACK_VIDEO_ID,
} from "@/server/services/download-health";

/** Sample a real in-library YouTube track so the probe mirrors actual usage.
    Falls back to a permanent public video if the DB is empty/unreachable. */
async function pickTarget(): Promise<string> {
  try {
    const rows = await db.track.findMany({
      where: { inLibrary: true, playable: true, ytVideoId: { not: null } },
      select: { ytVideoId: true },
      take: 200,
    });
    const ids = rows.map((r) => r.ytVideoId!).filter(Boolean);
    if (ids.length > 0) return ids[Math.floor(Math.random() * ids.length)]!;
  } catch {
    /* fall through to the constant */
  }
  return FALLBACK_VIDEO_ID;
}

/** Best-effort macOS desktop notification. No-op (logged) off macOS. */
function notify(title: string, body: string): void {
  if (process.platform !== "darwin") {
    console.error(`[notify skipped: ${process.platform}] ${title} — ${body}`);
    return;
  }
  // Pass copy via argv (not string-interpolated into AppleScript) to avoid
  // quote-escaping bugs; osascript reads them as `on run {argv}`.
  const script =
    'on run argv\n' +
    '  display notification (item 2 of argv) with title (item 1 of argv) sound name "Basso"\n' +
    'end run';
  const proc = spawn("osascript", ["-e", script, title, body], { stdio: "ignore" });
  proc.on("error", (e) => console.error("osascript failed:", e.message));
}

async function main() {
  const videoId = await pickTarget();
  const stamp = new Date().toISOString();
  console.log(`[health] ${stamp} probing download of ${videoId}…`);

  const verdict = interpretProbe(await runDownloadProbe(videoId));

  if (verdict.healthy) {
    console.log(`[health] OK — ${verdict.body}`);
    await db.$disconnect().catch(() => {});
    process.exit(0);
  }

  console.error(`[health] ALERT — ${verdict.body}`);
  notify(verdict.title, verdict.body);
  await db.$disconnect().catch(() => {});
  process.exit(1);
}

main().catch(async (e) => {
  console.error("[health] probe crashed:", e);
  notify("Kyowave downloads FAILING", `Health check crashed: ${e instanceof Error ? e.message : e}`);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
