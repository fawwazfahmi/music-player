import { spawn } from "node:child_process";
import ytsr from "@distube/ytsr";
import { env } from "@/lib/env";

export interface YtSearchResult {
  videoId: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string | null;
}

function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(env.YT_DLP_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => reject(new Error(`yt-dlp spawn failed: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

// "4:23" -> 263, "1:02:30" -> 3750, "" -> 0
function parseDurationString(s: string | undefined | null): number {
  if (!s) return 0;
  const parts = s.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export async function searchYt(query: string, limit = 5): Promise<YtSearchResult[]> {
  // Uses @distube/ytsr (hits YouTube's innertube API directly) — ~1s.
  // yt-dlp's ytsearch is ~80s due to slow web-client-config fetch + bot detection.
  const result = await ytsr(query, { type: "video", limit });
  return result.items.slice(0, limit).map((item) => ({
    videoId: item.id,
    title: item.name,
    uploader: item.author?.name ?? "Unknown",
    duration: parseDurationString(item.duration),
    thumbnail: item.thumbnail ?? null,
  }));
}

export async function resolveDirectUrl(videoId: string): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const raw = await runYtDlp(["-f", "bestaudio[ext=m4a]/bestaudio", "-g", "--no-warnings", url]);
  return raw.trim().split("\n")[0] ?? "";
}

export interface DownloadResult {
  filePath: string;
  fileFormat: string;
}

export async function downloadAudio(videoId: string, destDir: string): Promise<DownloadResult> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outputTemplate = `${destDir}/${videoId}.%(ext)s`;
  await runYtDlp([
    url,
    "-x",
    "--audio-format",
    "m4a",
    "-o",
    outputTemplate,
    "--no-warnings",
    "--embed-metadata",
  ]);
  return { filePath: `${destDir}/${videoId}.m4a`, fileFormat: "m4a" };
}
