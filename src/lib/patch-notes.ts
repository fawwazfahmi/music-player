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
      { kind: "changed", text: "New name. Music Universe → Kyowave." },
      { kind: "changed", text: "New colour. Green → blue." },
      { kind: "added", text: "This box. Patch notes, and a permanent link in Settings." },
      { kind: "added", text: "Refresh keeps your queue. Picks up right where you paused." },
      { kind: "added", text: "Stats now shows when you listen, by hour and day." },
      { kind: "added", text: "Wrong cover art? Change it from a song's ⋯ menu." },
      { kind: "added", text: "Playlist links: pick the songs you want before downloading." },
      { kind: "added", text: "Downloads tab. Watch progress, retry, add to queue." },
      { kind: "added", text: "Connect YouTube in Settings for better mixes." },
      { kind: "fixed", text: "Songs play in Performance Mode again." },
      { kind: "fixed", text: "Performance Mode really hides the video now." },
      { kind: "fixed", text: "Mixes stop pulling in random unrelated songs." },
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
