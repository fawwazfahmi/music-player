/**
 * When the YouTube iframe should EXIST, and when it should be VISIBLE.
 *
 * These are two different questions, and conflating them has caused three
 * separate bugs:
 *
 *   1. Tying existence to the mobile sheet meant every reopen paid a full
 *      player rebuild — a second of black, and sometimes it never started at
 *      all until playback was toggled.
 *   2. The sheet's slot stayed in the DOM when closed, so on desktop it won
 *      the slot lookup and starved the right panel's video.
 *   3. Performance mode unmounted the stage while a track was still gated on
 *      it, deadlocking playback.
 *
 * So: build it once and keep it (`shouldMountVideoStage`), and merely pause it
 * when there is nowhere to show it (`isVideoPresenting`). A paused iframe costs
 * nothing; a destroyed one costs a rebuild.
 */

export interface VideoStageConditions {
  performanceMode: boolean;
  isMobile: boolean;
  /** Her per-device choice to see album art instead of the video. */
  mobileArtMode: boolean;
  /** False when the app is backgrounded or the screen is locked. */
  documentVisible: boolean;
  /** Whether the current track has a video at all. */
  currentHasVideo: boolean;
}

/** Should the iframe exist? Deliberately independent of the sheet being open. */
export function shouldMountVideoStage(c: VideoStageConditions): boolean {
  if (c.performanceMode) return false;
  if (!c.isMobile) return true;
  return c.mobileArtMode === false && c.documentVisible && c.currentHasVideo;
}

/**
 * Is there a slot on screen for it right now?
 *
 * Desktop always has one. Mobile only while the sheet is open — when it isn't,
 * the video pauses rather than being torn down.
 */
export function isVideoPresenting(args: { isMobile: boolean; sheetOpen: boolean }): boolean {
  return !args.isMobile || args.sheetOpen;
}
