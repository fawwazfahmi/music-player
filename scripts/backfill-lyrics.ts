// Re-resolve lyrics for tracks that are currently on Whisper output (garbage for
// Korean/Japanese) or whose stored plain text is junk. New chain: clean-title
// LRCLIB → uploader YouTube subtitles (romaji/English, synced) → clear if the
// old lyrics were junk and nothing better exists. Whisper is NOT re-run (the
// English-only model can't do CJK). Snapshots first.
// Usage: pnpm exec tsx --env-file=.env scripts/backfill-lyrics.ts
import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/db";
import { fetchLyrics } from "@/server/services/lrclib";
import { fetchUploaderSubtitles } from "@/server/services/yt-subtitles";
import { isJunkTranscript } from "@/server/services/whisper";
import { anyConnectedCookiePath } from "@/server/services/yt-cookies";

const SNAPSHOT = path.join(process.cwd(), "scripts", ".lyrics-backfill-snapshot.json");

async function main() {
  const cookiePath = await anyConnectedCookiePath().catch(() => null);

  const candidates = await db.track.findMany({
    where: {
      playable: true,
      OR: [{ lyricsSource: "WHISPER" }, { lyricsSource: null, ytVideoId: { not: null } }],
    },
    select: {
      id: true,
      title: true,
      duration: true,
      ytVideoId: true,
      lyricsSource: true,
      lyricsPlain: true,
      primaryArtist: { select: { name: true } },
      album: { select: { title: true } },
    },
    orderBy: { primaryArtist: { name: "asc" } },
  });

  // Only touch tracks that actually need it: on Whisper, or storing junk.
  const targets = candidates.filter(
    (t) => t.lyricsSource === "WHISPER" || (t.lyricsPlain != null && isJunkTranscript(t.lyricsPlain)),
  );
  fs.writeFileSync(SNAPSHOT, JSON.stringify(targets, null, 2));
  console.log(`[lyrics] ${targets.length} tracks to re-resolve (snapshot → ${SNAPSHOT})\n`);

  let lrclib = 0;
  let subs = 0;
  let cleared = 0;
  let kept = 0;

  for (const t of targets) {
    const artist = t.primaryArtist.name;
    const label = `${artist} — ${t.title}`;

    // 1) LRCLIB with cleaned title candidates.
    const lrc = await fetchLyrics(artist, t.title, t.album?.title, t.duration).catch(() => null);
    if (lrc && (lrc.syncedLyrics || lrc.plainLyrics)) {
      await db.track.update({
        where: { id: t.id },
        data: {
          lyricsSynced: lrc.syncedLyrics,
          lyricsPlain: lrc.plainLyrics,
          lyricsSource: lrc.syncedLyrics ? "LRCLIB_SYNCED" : "LRCLIB_PLAIN",
          lyricsFetched: new Date(),
        },
      });
      lrclib++;
      console.log(`  ✓ LRCLIB   ${label}`);
      continue;
    }

    // 2) Uploader YouTube subtitles (Latin-only).
    if (t.ytVideoId) {
      const s = await fetchUploaderSubtitles(t.ytVideoId, { cookiePath, latinOnly: true }).catch(() => null);
      if (s) {
        await db.track.update({
          where: { id: t.id },
          data: {
            lyricsSynced: s.syncedLrc || null,
            lyricsPlain: s.plain,
            lyricsSource: "YT_SUBTITLE",
            lyricsFetched: new Date(),
          },
        });
        subs++;
        console.log(`  ✓ SUBS(${s.lang}) ${label}`);
        continue;
      }
    }

    // 3) Nothing better. If the old lyrics were junk, clear them; else keep.
    if (t.lyricsSource === "WHISPER" && t.lyricsPlain != null && isJunkTranscript(t.lyricsPlain)) {
      await db.track.update({
        where: { id: t.id },
        data: { lyricsSynced: null, lyricsPlain: null, lyricsSource: null, lyricsFetched: new Date() },
      });
      cleared++;
      console.log(`  ·  cleared junk  ${label}`);
    } else {
      kept++;
    }
  }

  console.log(`\n[lyrics] done — LRCLIB ${lrclib}, subtitles ${subs}, cleared ${cleared}, kept ${kept}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
