// Weekly download-health probe. YouTube periodically gates more yt-dlp player
// clients, and when the pinned client (see PLAYER_CLIENTS in yt-service) starts
// 403ing, downloads silently fail — you only notice weeks later when songs are
// missing. This probe does one real audio download on a schedule and pings you
// the moment it breaks, so the fix (re-pin a working client) happens on your
// terms, not mid-listen.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { downloadAudio } from "@/server/services/yt-service";
import { anyConnectedCookiePath } from "@/server/services/yt-cookies";

// Fallback probe target if the DB has no in-library YouTube track to sample.
// "Me at the zoo" — the first-ever YouTube upload; about as permanent as videos
// get, so a 403 here is the client regression, never a takedown.
export const FALLBACK_VIDEO_ID = "jNQXAC9IVRw";

export interface ProbeOutcome {
  ok: boolean;
  videoId: string;
  stderr?: string;
}

export interface ProbeVerdict {
  healthy: boolean;
  title: string;
  body: string;
}

/** Turn a raw probe outcome into a human verdict + notification copy. Pure, so
    the 403-vs-other branching is unit-testable without touching the network. */
export function interpretProbe(o: ProbeOutcome): ProbeVerdict {
  if (o.ok) {
    return {
      healthy: true,
      title: "Kyowave downloads OK",
      body: `Probe download of ${o.videoId} succeeded.`,
    };
  }
  const stderr = o.stderr ?? "";
  const is403 = /403|forbidden/i.test(stderr);
  const firstLine = stderr.split("\n").find((l) => l.trim())?.trim() ?? "unknown error";
  const body = is403
    ? `Probe download of ${o.videoId} hit HTTP 403 — the pinned yt-dlp player_client is likely gated again. ` +
      `Re-test clients and update PLAYER_CLIENTS in src/server/services/yt-service.ts. (${firstLine})`
    : `Probe download of ${o.videoId} failed: ${firstLine}`;
  return { healthy: false, title: "Kyowave downloads FAILING", body };
}

/** Run one real audio download into a throwaway temp dir, then delete it. Never
    throws — a spawn/format failure comes back as { ok: false, stderr }. */
export async function runDownloadProbe(videoId: string): Promise<ProbeOutcome> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kyowave-probe-"));
  try {
    const cookiePath = await anyConnectedCookiePath().catch(() => null);
    const { filePath } = await downloadAudio(videoId, dir, { cookiePath });
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || stat.size < 10_000) {
      return { ok: false, videoId, stderr: "download produced no/empty file" };
    }
    return { ok: true, videoId };
  } catch (err) {
    return { ok: false, videoId, stderr: err instanceof Error ? err.message : String(err) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
