// What's-new entries, newest first.
//
// Shipped with the build rather than stored in the database: notes describe a
// release, so they should travel with the code that release contains. Adding
// an entry at the top is all it takes for everyone to be shown it once.
//
// Bump the top version whenever you add a release. "Seen" is tracked in
// localStorage, so a fresh browser or cleared storage shows the notes again —
// which is why Settings has a permanent way in as well.

export type ChangeKind = "added" | "fixed" | "changed";

export interface Change {
  kind: ChangeKind;
  text: string;
}

export interface Release {
  /** Sortable and comparable as a plain string; keep it zero-padded. */
  version: string;
  /** ISO date, shown to the reader. */
  date: string;
  title: string;
  changes: Change[];
}

export const PATCH_NOTES: Release[] = [
  {
    version: "2026.08.14",
    date: "2026-08-14",
    title: "Kyowave",
    changes: [
      { kind: "changed", text: "Music Universe is now Kyowave, on kyowave.wazfahmi.site." },
      {
        kind: "added",
        text: "The player survives a refresh. Your queue and the song you were on come back, parked exactly where you stopped — paused, not playing.",
      },
      {
        kind: "added",
        text: "Stats has a Rhythm tab: a heatmap of when you actually listen, by hour and weekday.",
      },
      {
        kind: "added",
        text: "Change cover… in a song's ⋯ menu, for when the album art is wrong or badly cropped. Re-transcribe moved in there too.",
      },
      {
        kind: "added",
        text: "Paste a YouTube playlist or mix and you now get to review the songs first, ticking off anything you don't want before a single byte downloads.",
      },
      {
        kind: "added",
        text: "A Downloads tab with real progress that survives a reload, plus retry on failures and add-to-queue when they land.",
      },
      {
        kind: "added",
        text: "Settings → Connect YouTube. Upload a cookies.txt and mixes resolve as your account instead of a generic one.",
      },
      {
        kind: "fixed",
        text: "Performance Mode actually removes the video now — it used to leave the iframe on screen if you switched it on mid-session.",
      },
      {
        kind: "fixed",
        text: "Songs play in Performance Mode. Playback was waiting for a video that the mode had already removed, so nothing ever started.",
      },
      {
        kind: "fixed",
        text: "Mixes no longer fill the queue with unrelated songs. They're bounded and de-duplicated instead of running off into whatever YouTube felt like.",
      },
      { kind: "fixed", text: "The lightning bolt icon sits centred now, in the player bar and the dialog." },
    ],
  },
];

export const CURRENT_VERSION = PATCH_NOTES[0]?.version ?? "0";

export const SEEN_STORAGE_KEY = "kyowave:patch-notes-seen";

/**
 * Releases the reader hasn't been shown yet.
 *
 * A null/absent `seen` means a fresh browser or cleared storage: show
 * everything, since as far as we can tell they've read none of it.
 */
export function unseenReleases(seen: string | null): Release[] {
  if (!seen) return PATCH_NOTES;
  return PATCH_NOTES.filter((r) => r.version > seen);
}

export function readSeenVersion(): string | null {
  try {
    if (typeof localStorage === "undefined" || !localStorage?.getItem) return null;
    return localStorage.getItem(SEEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function markSeen(version: string = CURRENT_VERSION): void {
  try {
    if (typeof localStorage === "undefined" || !localStorage?.setItem) return;
    localStorage.setItem(SEEN_STORAGE_KEY, version);
  } catch {
    /* storage disabled — they'll just be shown the notes again */
  }
}

/**
 * Bar heights (0..1) for a release's waveform strip.
 *
 * Deterministic from the version string, so each release gets its own wave and
 * it never changes between renders. Not random: a wave that reshuffled on every
 * open would read as noise rather than as a property of the release.
 */
export function waveformBars(seed: string, count = 48): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    // Keep it in a readable band — bars at 0 look like gaps, bars at 1 look
    // like a solid block.
    bars.push(0.25 + (Math.abs(h) % 1000) / 1000 * 0.75);
  }
  return bars;
}
