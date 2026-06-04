import { spawn } from "node:child_process";
import { env } from "@/lib/env";

export interface YtSearchResult {
  videoId: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string | null;
}

interface YtJson {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
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
  const args = [
    `ytsearch${limit}:${query}`,
    "--no-warnings",
    "-J",
    "--flat-playlist",
  ];
  const raw = await runYtDlp(args);
  const parsed = JSON.parse(raw) as YtJson & { entries?: YtJson[] };
  const entries: YtJson[] = parsed.entries ?? [parsed];
  return entries
    .filter((e): e is YtJson & { id: string } => typeof e.id === "string")
    .slice(0, limit)
    .map((e) => ({
      videoId: e.id,
      title: e.title ?? "Unknown",
      uploader: e.uploader ?? e.channel ?? "Unknown",
      duration: Math.round(e.duration ?? 0),
      thumbnail: e.thumbnail ?? null,
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
