import { execFile } from "node:child_process";
import { env } from "@/lib/env";

/** Map ffmpeg integrated loudness (LUFS) to a 0..1 energy proxy. Quiet masters
    (~-30 LUFS) → ~0, hot/compressed masters (~-5 LUFS) → ~1. Objective, cheap,
    and a strong discriminator on the energetic↔chill/sad axis. NaN → 0.5. */
export function lufsToEnergy(lufs: number): number {
  if (!Number.isFinite(lufs)) return 0.5;
  const e = (lufs + 30) / 25;
  return e < 0 ? 0 : e > 1 ? 1 : e;
}

/** Measure a local audio file's energy via ffmpeg loudnorm analysis. Returns
    0..1, or null when the file is missing/unreadable or ffmpeg fails. Never
    throws — audio analysis is an enhancement, not a hard dependency. */
export async function analyzeEnergy(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      env.FFMPEG_PATH,
      ["-hide_banner", "-nostats", "-i", filePath, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
      (_err, stdout, stderr) => {
        const out = `${stderr ?? ""}${stdout ?? ""}`;
        const m = out.match(/"input_i"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/);
        if (!m) {
          resolve(null);
          return;
        }
        const lufs = parseFloat(m[1]!);
        resolve(Number.isFinite(lufs) ? lufsToEnergy(lufs) : null);
      },
    );
  });
}
