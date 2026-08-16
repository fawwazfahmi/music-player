import { db } from "@/server/db";
import { fetchYtMeta as realFetchYtMeta, type YtMeta } from "@/server/services/yt-service";
import { tidyTitle, normalizeWidth, parseYtMusicDescription } from "@/lib/title-clean";

const MAX_ARTISTS = 3;

export interface CleanInput {
  videoId: string | null;
  title: string;
  artist: string;
  album: string;
}

export interface CleanResult {
  title: string;
  artists: string[];
  album: string | null;
  source: "ytmeta" | "description" | "deterministic";
}

export interface CleanerDeps {
  fetchYtMeta?: (videoId: string) => Promise<YtMeta | null>;
}

function stripTopic(name: string): string {
  return name.replace(/\s*-\s*topic\s*$/i, "").trim();
}

/**
 * Resolve a clean title + real artist(s) for a track, GROUNDED — never guessed:
 *   1. YouTube's own music metadata (Art Track / "- Topic") via yt-dlp.
 *   2. The "Provided to YouTube by … Title · Artist" description credit block.
 *   3. Deterministic text cleanup (fix fonts, drop noise, keep version markers)
 *      with the artist taken only from the literal text ("- Topic" stripped).
 * Always returns a best-effort clean result; the caller decides whether it
 * differs enough to apply.
 *
 * NB: a MusicBrainz freeform fallback was prototyped and rejected — on this
 * re-upload-heavy library its recording search returns confidently-wrong
 * artists for common titles (VØJ→Hurakion, "Purple Rain"→"November Rain"), so
 * it corrupts more than it fixes. The handful of genuinely garbled re-uploads
 * are corrected by hand instead (grounded in the real video title).
 */
export async function resolveCleanMeta(
  input: CleanInput,
  deps: CleanerDeps = {},
): Promise<CleanResult> {
  const fetchYtMeta = deps.fetchYtMeta ?? realFetchYtMeta;

  if (input.videoId) {
    const meta = await fetchYtMeta(input.videoId).catch(() => null);
    if (meta) {
      if (meta.track && meta.artists.length > 0) {
        return {
          title: normalizeWidth(meta.track).trim(),
          artists: dedupe(meta.artists).slice(0, MAX_ARTISTS),
          album: meta.album,
          source: "ytmeta",
        };
      }
      const credits = parseYtMusicDescription(meta.description);
      if (credits) {
        return {
          title: normalizeWidth(credits.title).trim(),
          artists: dedupe(credits.artists).slice(0, MAX_ARTISTS),
          album: credits.album,
          source: "description",
        };
      }
    }
  }

  // Deterministic: clean the title text; take the artist only from what's
  // literally there (strip "- Topic"). Never invent.
  return {
    title: tidyTitle(input.title),
    artists: [stripTopic(input.artist) || input.artist],
    album: null,
    source: "deterministic",
  };
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));
}

function artistsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.toLowerCase() === b[i]!.toLowerCase());
}

export interface ApplyDeps {
  resolveCleanMeta?: (input: CleanInput) => Promise<CleanResult>;
}

/**
 * Apply grounded clean metadata to a track: update its title, re-link the real
 * primary + additional artist(s), and move it to the real album when known.
 * Returns whether anything changed. Used by the backfill (post-approval) and
 * automatically for new downloads. Never invents data — see resolveCleanMeta.
 */
export async function applyCleanMeta(
  trackId: string,
  deps: ApplyDeps = {},
): Promise<{ changed: boolean; title?: string; artists?: string[]; album?: string | null }> {
  const resolve = deps.resolveCleanMeta ?? resolveCleanMeta;
  const track = await db.track.findUnique({
    where: { id: trackId },
    select: {
      id: true,
      title: true,
      ytVideoId: true,
      album: { select: { title: true } },
      primaryArtist: { select: { name: true } },
      additionalArtists: { select: { artist: { select: { name: true } } } },
    },
  });
  if (!track) return { changed: false };

  const currentArtists = [track.primaryArtist.name, ...track.additionalArtists.map((a) => a.artist.name)];
  const r = await resolve({
    videoId: track.ytVideoId,
    title: track.title,
    artist: track.primaryArtist.name,
    album: track.album?.title ?? "",
  });

  const titleChanged = r.title.length > 0 && r.title !== track.title;
  const artistsChanged = r.artists.length > 0 && !artistsEqual(currentArtists, r.artists);
  const albumChanged = !!r.album && r.album !== track.album?.title;
  if (!titleChanged && !artistsChanged && !albumChanged) return { changed: false };

  if (titleChanged) {
    await db.track.update({ where: { id: trackId }, data: { title: r.title } });
  }

  let primaryArtistId: string | null = null;
  if (artistsChanged) {
    const primary = await db.artist.upsert({
      where: { name: r.artists[0]! },
      create: { name: r.artists[0]! },
      update: {},
      select: { id: true },
    });
    primaryArtistId = primary.id;
    await db.track.update({ where: { id: trackId }, data: { primaryArtistId: primary.id } });
    await db.trackArtist.deleteMany({ where: { trackId } });
    for (const name of r.artists.slice(1)) {
      const a = await db.artist.upsert({
        where: { name },
        create: { name },
        update: {},
        select: { id: true },
      });
      await db.trackArtist.upsert({
        where: { trackId_artistId: { trackId, artistId: a.id } },
        create: { trackId, artistId: a.id, role: "artist" },
        update: {},
      });
    }
  }

  if (albumChanged && r.album) {
    // Album is unique per (artistId, title); hang it off the (possibly new)
    // primary artist so it leaves the catch-all "YouTube" album.
    const artistId =
      primaryArtistId ??
      (await db.track.findUnique({ where: { id: trackId }, select: { primaryArtistId: true } }))!
        .primaryArtistId;
    const album = await db.album.upsert({
      where: { artistId_title: { artistId, title: r.album } },
      create: { title: r.album, artistId },
      update: {},
      select: { id: true },
    });
    await db.track.update({ where: { id: trackId }, data: { albumId: album.id } });
  }

  return { changed: true, title: r.title, artists: r.artists, album: r.album };
}
