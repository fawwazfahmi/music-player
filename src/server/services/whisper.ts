// Whisper transcription via whisper.cpp (whisper-cli) + ffmpeg.
//
// Pipeline:
//   1. ffmpeg → 16 kHz mono WAV in temp dir
//   2. whisper-cli with --output-lrc → produces <prefix>.lrc
//   3. Read the .lrc file, strip header, normalize to LRCLIB-style LRC string
//   4. Derive plain text by stripping timestamps
//   5. Clean up temp files

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const WHISPER_BIN = process.env.WHISPER_BIN ?? "/opt/homebrew/bin/whisper-cli";
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ??
  path.join(process.env.HOME ?? "", ".cache/whisper-models/ggml-small.en.bin");
const FFMPEG_BIN = process.env.FFMPEG_BIN ?? "/opt/homebrew/bin/ffmpeg";

export interface WhisperResult {
  syncedLrc: string;
  plainText: string;
}

interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (msg: string) => void;
}

function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { signal: opts.signal });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      opts.onProgress?.(s);
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      opts.onProgress?.(s);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export async function transcribeFile(
  audioPath: string,
  opts: RunOptions = {},
): Promise<WhisperResult> {
  const work = await mkdtemp(path.join(tmpdir(), "music-whisper-"));
  try {
    const wavPath = path.join(work, "in.wav");
    const outPrefix = path.join(work, "out");

    // 1) Extract 16 kHz mono WAV (the format whisper.cpp expects)
    await run(
      FFMPEG_BIN,
      [
        "-y", // overwrite
        "-i", audioPath,
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        wavPath,
      ],
      opts,
    );

    // 2) Run whisper-cli, emit .lrc
    await run(
      WHISPER_BIN,
      [
        "-m", WHISPER_MODEL,
        "-f", wavPath,
        "--output-lrc",
        "-of", outPrefix,
        "--no-prints",
      ],
      opts,
    );

    const lrc = await readFile(`${outPrefix}.lrc`, "utf-8");
    const syncedLrc = normalizeLrc(lrc);
    const plainText = lrcToPlainText(syncedLrc);

    return { syncedLrc, plainText };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// whisper.cpp emits LRC headers like "[by:whisper.cpp]" and timestamps in
// [mm:ss.xx] form. LRCLIB and our parser both accept that, but strip header
// lines (any [tag:value] that isn't a timestamp) so storage stays clean.
function normalizeLrc(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Header tags like [by:whisper.cpp] — drop. Timestamp tags are [mm:ss.xx].
    if (/^\[[a-z]+:/i.test(line) && !/^\[\d{1,2}:\d{2}/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

function lrcToPlainText(lrc: string): string {
  return lrc
    .split(/\r?\n/)
    .map((l) => l.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}
