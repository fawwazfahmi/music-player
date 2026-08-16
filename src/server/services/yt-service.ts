import { spawn } from "node:child_process";
import { Innertube } from "youtubei.js";
import { env } from "@/lib/env";

export interface YtSearchResult {
  videoId: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string | null;
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
};

export interface YtDlpProgress {
  /** 0..100 — percent complete reported by yt-dlp. */
  pct: number;
  /** Total bytes if yt-dlp could compute it ahead of the download. */
  totalBytes: number | null;
}

// yt-dlp emits lines like:
//   [download]  17.3% of  4.32MiB at  500.00KiB/s ETA 00:05
//   [download] 100% of  4.32MiB in 00:08
const PROGRESS_RE =
  /^\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+)\s*([KMG]?i?B)/;

function parseProgress(line: string): YtDlpProgress | null {
  const m = PROGRESS_RE.exec(line.trim());
  if (!m) return null;
  const pct = parseFloat(m[1]!);
  const size = parseFloat(m[2]!);
  const unit = SIZE_UNITS[m[3]!] ?? null;
  return {
    pct: Math.min(100, Math.max(0, pct)),
    totalBytes: unit !== null && Number.isFinite(size) ? Math.round(size * unit) : null,
  };
}

export interface RunYtDlpOptions {
  onProgress?: (p: YtDlpProgress) => void;
  /** Path to a Netscape-format cookie jar. When set, yt-dlp resolves the
      request as that logged-in YouTube account — which is what makes a Mix
      come back personalized rather than cold-start generic. Null/undefined
      means run anonymously (the historical behaviour). */
  cookiePath?: string | null;
}

function runYtDlp(args: string[], opts: RunYtDlpOptions = {}): Promise<string> {
  const finalArgs = opts.cookiePath ? [...args, "--cookies", opts.cookiePath] : args;
  return new Promise((resolve, reject) => {
    const proc = spawn(env.YT_DLP_PATH, finalArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let buf = "";
    function feed(chunk: Buffer) {
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.search(/[\r\n]/)) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line && opts.onProgress) {
          const p = parseProgress(line);
          if (p) opts.onProgress(p);
        }
      }
    }
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (opts.onProgress) feed(chunk);
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

type InnertubeVideo = {
  type?: string;
  video_id?: string;
  id?: string;
  title?: { toString(): string } | string;
  author?: { name?: string };
  duration?: { seconds?: number };
  best_thumbnail?: { url?: string };
  thumbnails?: { url?: string }[];
};

function titleText(title: InnertubeVideo["title"]): string {
  if (!title) return "Unknown";
  return typeof title === "string" ? title : title.toString();
}

function mapInnertubeVideo(video: InnertubeVideo): YtSearchResult | null {
  const videoId = video.video_id ?? video.id ?? "";
  if (!videoId) return null;
  const thumbnail = video.best_thumbnail?.url ?? video.thumbnails?.at(-1)?.url ?? null;
  return {
    videoId,
    title: titleText(video.title),
    uploader: video.author?.name ?? "Unknown",
    duration: Math.round(video.duration?.seconds ?? 0),
    thumbnail,
  };
}

type YtDlpEntry = {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: { url?: string }[];
};

function mapYtDlpEntry(entry: YtDlpEntry): YtSearchResult | null {
  if (!entry.id) return null;
  return {
    videoId: entry.id,
    title: entry.title ?? "Unknown",
    uploader: entry.uploader ?? entry.channel ?? "Unknown",
    duration: Math.round(entry.duration ?? 0),
    thumbnail: entry.thumbnail ?? entry.thumbnails?.at(-1)?.url ?? null,
  };
}

async function searchWithInnertube(query: string, limit: number): Promise<YtSearchResult[]> {
  const youtube = await Innertube.create();
  const search = await youtube.search(query, { type: "video" });
  return (search.results as unknown as InnertubeVideo[])
    .map(mapInnertubeVideo)
    .filter((item): item is YtSearchResult => item !== null)
    .slice(0, limit);
}

async function searchWithYtDlp(query: string, limit: number): Promise<YtSearchResult[]> {
  const raw = await runYtDlp([
    `ytsearch${limit}:${query}`,
    "--dump-single-json",
    "--flat-playlist",
    "--no-warnings",
  ]);
  const parsed = JSON.parse(raw) as { entries?: YtDlpEntry[] } | YtDlpEntry[];
  const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? [];
  return entries
    .map(mapYtDlpEntry)
    .filter((item): item is YtSearchResult => item !== null)
    .slice(0, limit);
}

export interface FetchPlaylistOptions {
  /** Stop yt-dlp after N entries. Essential for mixes: a mix is an infinite
      algorithmic radio, so an unbounded fetch walks continuation pages
      forever — observed returning 1769 entries that were only 372 unique
      videos. Omit for curated playlists, which are finite and must not be
      truncated. */
  playlistEnd?: number;
  cookiePath?: string | null;
}

export interface FetchPlaylistResult {
  /** yt-dlp's playlist title, e.g. "Mix - Rick Astley - Never Gonna…". */
  title: string;
  entries: YtSearchResult[];
}

/**
 * Fetch a YouTube playlist (or "mix" / radio) by URL. Uses yt-dlp's
 * --flat-playlist mode, which returns just the video IDs / titles / durations
 * without resolving each video's stream URL — fast and cheap, suitable for
 * showing the list before deciding to download anything.
 *
 * Returns empty entries if yt-dlp can't recognize the URL as a playlist.
 */
export async function fetchPlaylist(
  url: string,
  opts: FetchPlaylistOptions = {},
): Promise<FetchPlaylistResult> {
  const args = [url, "--flat-playlist", "--dump-single-json", "--no-warnings"];
  if (opts.playlistEnd !== undefined) {
    args.push("--playlist-end", String(opts.playlistEnd));
  }
  const raw = await runYtDlp(args, { cookiePath: opts.cookiePath });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { title: "", entries: [] };
  }
  const entries = Array.isArray(parsed)
    ? (parsed as YtDlpEntry[])
    : (parsed as { entries?: YtDlpEntry[] }).entries ?? [];
  const title = Array.isArray(parsed)
    ? ""
    : (parsed as { title?: string }).title ?? "";
  return {
    title,
    entries: entries.map(mapYtDlpEntry).filter((x): x is YtSearchResult => x !== null),
  };
}

export async function searchYt(query: string, limit = 5): Promise<YtSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const results = await searchWithInnertube(trimmed, limit);
    if (results.length > 0) return results;
  } catch (err) {
    console.warn("youtubei.js search failed; falling back to yt-dlp", err);
  }

  return searchWithYtDlp(trimmed, limit);
}

export interface YtMeta {
  track: string | null;
  artists: string[];
  album: string | null;
  description: string;
  uploader: string;
}

/** Fetch YouTube's own metadata for a video (no audio download). For Art
    Tracks / "- Topic" uploads this yields the real track/artist(s)/album from
    YouTube Music; for plain uploads most fields are empty. Null on failure. */
export async function fetchYtMeta(videoId: string): Promise<YtMeta | null> {
  try {
    const raw = await runYtDlp([
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    const j = JSON.parse(raw) as {
      track?: string;
      artist?: string;
      artists?: string[];
      album?: string;
      description?: string;
      uploader?: string;
      channel?: string;
    };
    const artists = Array.isArray(j.artists)
      ? j.artists.filter((x): x is string => typeof x === "string")
      : typeof j.artist === "string"
        ? j.artist.split(/,\s*/).map((s) => s.trim()).filter(Boolean)
        : [];
    return {
      track: j.track ?? null,
      artists,
      album: j.album ?? null,
      description: j.description ?? "",
      uploader: j.uploader ?? j.channel ?? "",
    };
  } catch {
    return null;
  }
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

export async function downloadAudio(
  videoId: string,
  destDir: string,
  onProgress?: (p: YtDlpProgress) => void,
): Promise<DownloadResult> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outputTemplate = `${destDir}/${videoId}.%(ext)s`;
  await runYtDlp(
    [
      url,
      "-x",
      "--audio-format",
      "m4a",
      "-o",
      outputTemplate,
      "--no-warnings",
      "--embed-metadata",
      // --newline forces yt-dlp to emit each progress update on its own line
      // instead of overwriting with \r, which lets our line-buffered parser see
      // every tick.
      "--newline",
    ],
    { onProgress },
  );
  return { filePath: `${destDir}/${videoId}.m4a`, fileFormat: "m4a" };
}
