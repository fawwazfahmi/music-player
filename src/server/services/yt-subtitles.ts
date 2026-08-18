// Uploader-provided YouTube captions → lyrics.
//
// For Korean/Japanese songs, Whisper transcribes to "(singing in foreign
// language)" and LRCLIB sometimes has no entry. But the label/uploader often
// attaches the real lyrics as a MANUAL caption track (`subtitles` in yt-dlp's
// JSON). We use ONLY those — never `automatic_captions`, which are machine
// ASR + machine translation and read like garbage. VTT cues are timestamped,
// so these come out as synced lyrics.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { env } from "@/lib/env";
import { romanizeLyrics } from "@/server/services/romanize";

export interface SubtitleLyrics {
  syncedLrc: string;
  plain: string;
}

export interface UploaderSubtitles extends SubtitleLyrics {
  lang: string;
}

// Native-script order (CJK first) — used only when the caller explicitly wants
// the original language (the future per-song picker, which will romanize it).
const NATIVE_PRIORITY = ["ko", "ja", "zh-Hant", "zh-Hans", "zh", "en-orig", "en", "en-US"];

// The app displays lyrics in romaji/English ONLY — never raw Hangul/Kana/Hanzi.
// A romanized caption track ("ko-Latn") is the sung lyrics in Latin and is
// ideal; an English track is an acceptable (translated) fallback. Anything in a
// non-Latin script is rejected in this mode.
const ROMANIZED_RE = /-Latn\b/i;
const EN_RE = /^en(?:-|$)/i;

export interface PickLangOptions {
  /** From the ASR "<lang>-orig" marker; only consulted when latinOnly is off. */
  originalLang?: string;
  /** Default true: return only a romanized or English track, else null. */
  latinOnly?: boolean;
}

/** Choose which manual-subtitle language to pull. Pure + testable. */
export function pickSubtitleLang(available: string[], opts: PickLangOptions = {}): string | null {
  const latinOnly = opts.latinOnly ?? true;
  const usable = available.filter((l) => l && !l.includes("live_chat"));
  if (usable.length === 0) return null;

  if (latinOnly) {
    // Prefer a romanized track (the actual sung lyrics in Latin) over an
    // English translation. Never fall through to a non-Latin script.
    const romaji = usable.find((l) => ROMANIZED_RE.test(l));
    if (romaji) return romaji;
    const en = ["en", "en-US", "en-orig", "en-GB"].find((l) => usable.includes(l));
    return en ?? usable.find((l) => EN_RE.test(l)) ?? null;
  }

  const priority = [opts.originalLang, ...NATIVE_PRIORITY].filter((x): x is string => !!x);
  for (const p of priority) if (usable.includes(p)) return p;
  return usable[0]!;
}

const TIMING_RE = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->/;

function stamp(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const cs = Math.floor((totalSec * 100) % 100);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `[${p2(m)}:${p2(s)}.${p2(cs)}]`;
}

/** Convert a WEBVTT caption file into synced LRC + plain text. Drops inline
    tags and collapses consecutive duplicate lines (karaoke tracks repeat). */
export function vttToLrc(vtt: string): SubtitleLyrics {
  const lines = vtt.split(/\r?\n/);
  const lrc: string[] = [];
  const plain: string[] = [];
  let last = "";
  let i = 0;
  while (i < lines.length) {
    const m = TIMING_RE.exec(lines[i]!.trim());
    if (!m) {
      i++;
      continue;
    }
    const hh = m[1] ? parseInt(m[1], 10) : 0;
    const total = hh * 3600 + parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10) + parseInt(m[4]!, 10) / 1000;
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !TIMING_RE.test(lines[i]!.trim())) {
      textLines.push(lines[i]!);
      i++;
    }
    const text = textLines
      .join(" ")
      .replace(/<[^>]*>/g, "") // <c>, </c>, inline <00:00:00.000> karaoke timing
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!text || text === last) continue;
    last = text;
    lrc.push(`${stamp(total)} ${text}`);
    plain.push(text);
  }
  return { syncedLrc: lrc.join("\n"), plain: plain.join("\n") };
}

function runYtDlp(args: string[], cookiePath?: string | null): Promise<string> {
  const finalArgs = cookiePath ? [...args, "--cookies", cookiePath] : args;
  return new Promise((resolve, reject) => {
    const proc = spawn(env.YT_DLP_PATH, finalArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    proc.stderr?.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr.slice(0, 300)))));
  });
}

interface YtSubMeta {
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
}

/** Fetch the best uploader-provided caption track for a video as lyrics, or
    null if it has no manual captions we can use. Never throws. */
export async function fetchUploaderSubtitles(
  videoId: string,
  opts: { cookiePath?: string | null; latinOnly?: boolean } = {},
): Promise<UploaderSubtitles | null> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const raw = await runYtDlp(
      [url, "--dump-single-json", "--skip-download", "--no-warnings"],
      opts.cookiePath,
    );
    const meta = JSON.parse(raw) as YtSubMeta;
    const subs = Object.keys(meta.subtitles ?? {});
    if (subs.length === 0) return null; // no MANUAL captions → don't touch auto ones
    const autoOrig = Object.keys(meta.automatic_captions ?? {})
      .find((k) => k.endsWith("-orig"))
      ?.replace(/-orig$/, "");
    const lang = pickSubtitleLang(subs, { originalLang: autoOrig, latinOnly: opts.latinOnly });
    if (!lang) return null;

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kyowave-subs-"));
    try {
      await runYtDlp(
        [
          url,
          "--skip-download",
          "--write-subs",
          "--sub-langs",
          lang,
          "--sub-format",
          "vtt",
          "-o",
          `${dir}/s.%(ext)s`,
          "--no-warnings",
        ],
        opts.cookiePath,
      );
      const vtt = await fs.readFile(path.join(dir, `s.${lang}.vtt`), "utf8").catch(() => null);
      if (!vtt) return null;
      const parsed = vttToLrc(vtt);
      if (!parsed.plain) return null;
      // Native-script tracks (picker's latinOnly:false) get romanized to Latin.
      const syncedLrc = romanizeLyrics(parsed.syncedLrc);
      const plain = romanizeLyrics(parsed.plain);
      return { syncedLrc, plain, lang };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } catch {
    return null;
  }
}
