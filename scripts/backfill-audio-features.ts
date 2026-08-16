// Extract audio features for local library files via the Essentia pipeline and
// store them. Run scripts/audio/setup.sh first. Heavy (~20s/track), so this is
// a background one-off.
// Usage: pnpm exec tsx --env-file=.env scripts/backfill-audio-features.ts [--force] [limit]

import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { db } from "@/server/db";
import { storeAudioFeatures, type RawAudioFeatures } from "@/server/services/audio-analysis";

const PY =
  process.env.AUDIO_ANALYZER_PY ??
  path.join(os.homedir(), ".cache", "kyowave", "audio-venv", "bin", "python");
const SCRIPT = path.join(process.cwd(), "scripts", "audio", "extract_features.py");
const CHUNK = 8; // paths per python process — amortizes model load, bounds memory

interface Line {
  path: string;
  ok: boolean;
  features?: RawAudioFeatures;
}

function analyzeChunk(paths: string[]): Promise<Line[]> {
  return new Promise((resolve) => {
    // Ignore stderr: TensorFlow floods it, and an undrained stderr pipe fills
    // and deadlocks the child. We only need stdout (the JSON lines).
    const proc = spawn(PY, [SCRIPT, ...paths], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", () => resolve([]));
    proc.on("close", () => {
      const lines: Line[] = [];
      for (const raw of out.split("\n")) {
        const s = raw.trim();
        if (!s) continue;
        try {
          lines.push(JSON.parse(s) as Line);
        } catch {
          /* skip non-JSON */
        }
      }
      resolve(lines);
    });
  });
}

export async function backfillAudioFeatures(
  opts: { force?: boolean; limit?: number } = {},
): Promise<{ analyzed: number; total: number }> {
  const tracks = await db.track.findMany({
    where: { filePath: { not: null }, ...(opts.force ? {} : { audioFeatures: { is: null } }) },
    select: { id: true, filePath: true },
    take: opts.limit,
  });
  const byPath = new Map(tracks.map((t) => [t.filePath!, t.id]));
  const paths = [...byPath.keys()];
  let analyzed = 0;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const results = await analyzeChunk(chunk);
    for (const r of results) {
      const trackId = byPath.get(r.path);
      if (trackId && r.ok && r.features) {
        await storeAudioFeatures(trackId, r.features);
        analyzed++;
      }
    }
    console.log(`[audio] ${Math.min(i + CHUNK, paths.length)}/${paths.length} (stored ${analyzed})`);
  }
  return { analyzed, total: paths.length };
}

if (process.argv[1] && process.argv[1].endsWith("backfill-audio-features.ts")) {
  const force = process.argv.includes("--force");
  const limitArg = process.argv.find((a) => /^\d+$/.test(a));
  backfillAudioFeatures({ force, limit: limitArg ? Number(limitArg) : undefined })
    .then((r) => {
      console.log(`[audio] done — analyzed ${r.analyzed}/${r.total} tracks`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[audio] backfill failed:", err);
      process.exit(1);
    });
}
