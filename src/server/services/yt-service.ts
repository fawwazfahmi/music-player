import { spawn } from "node:child_process";
import YouTube from "youtube-sr";
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

export async function searchYt(query: string, limit = 5): Promise<YtSearchResult[]> {
  // Uses youtube-sr (hits YouTube's innertube API directly) — ~1-3s.
  // yt-dlp's ytsearch is ~80s due to slow web-client-config fetch + bot detection.
  // Was @distube/ytsr but YT changed response shape and it stopped working.
  const items = await YouTube.search(query, { type: "video", limit });
  return items.slice(0, limit).map((v) => ({
    videoId: v.id ?? "",
    title: v.title ?? "Unknown",
    uploader: v.channel?.name ?? "Unknown",
    duration: Math.round((v.duration ?? 0) / 1000), // YouTube returns ms; we want seconds
    thumbnail: v.thumbnail?.url ?? null,
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
