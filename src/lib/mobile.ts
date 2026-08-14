// Touch/iOS detection and the little bits of learned state that only matter on
// a phone. Every function here takes its inputs explicitly so it can be tested
// without a browser; the thin `read*` wrappers at the bottom are the only parts
// that touch real globals.

export const INSTALL_HINT_KEY = "kyowave:install-hint-dismissed";
export const COACH_LONGPRESS_KEY = "kyowave:coach-longpress-seen";
export const LONGPRESS_COUNT_KEY = "kyowave:longpress-count";
export const MENU_BUTTON_PREF_KEY = "kyowave:menu-button-pref";

/** Successful long-presses after which the training-wheel ⋮ retires. */
export const LEARNED_AFTER = 3;

/** Below this width we render the mobile shell. Matches Tailwind's `md`. */
export const MOBILE_MAX_WIDTH = 767;

export type MenuButtonPref = "always" | "until-learned" | "never";

export const MENU_BUTTON_PREFS: readonly MenuButtonPref[] = [
  "always",
  "until-learned",
  "never",
];

export function isMenuButtonPref(v: unknown): v is MenuButtonPref {
  return typeof v === "string" && (MENU_BUTTON_PREFS as readonly string[]).includes(v);
}

export interface NavigatorLike {
  userAgent: string;
  maxTouchPoints: number;
  /** Legacy iOS-only flag, true when launched from the home screen. */
  standalone?: boolean;
}

/**
 * True for iPhone, iPod and iPad — including the case that trips everyone up.
 *
 * Since iPadOS 13 an iPad reports itself as `Macintosh`, so a naive UA test
 * misses every iPad. What separates it from a real Mac is the touch-point
 * count: desktop Safari reports 0, an iPad reports 5. A Mac with a touchscreen
 * does not exist, so this is safe in the direction that matters — we would
 * rather never show the hint on a desktop than show it on every desktop.
 */
export function isIOSDevice(nav: NavigatorLike): boolean {
  const ua = nav.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && nav.maxTouchPoints > 1;
}

/**
 * True when the page is running as an installed app rather than a browser tab.
 *
 * Checks both spellings: `display-mode: standalone` is the standard, and
 * `navigator.standalone` is the older iOS-only flag that still reports
 * correctly on home-screen launches.
 */
export function isStandaloneDisplay(
  nav: NavigatorLike,
  matchMedia: ((q: string) => { matches: boolean }) | undefined,
): boolean {
  if (nav.standalone === true) return true;
  if (!matchMedia) return false;
  try {
    return matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

/** iOS, not already installed, not previously dismissed. All three, or nothing. */
export function shouldShowInstallHint(args: {
  nav: NavigatorLike;
  matchMedia: ((q: string) => { matches: boolean }) | undefined;
  dismissed: boolean;
}): boolean {
  if (args.dismissed) return false;
  if (!isIOSDevice(args.nav)) return false;
  return !isStandaloneDisplay(args.nav, args.matchMedia);
}

/**
 * Whether a row still shows its ⋮ button.
 *
 * "until-learned" is the interesting one: the button is a teacher, not a
 * permanent control. It stays until she has opened the menu by long-press
 * LEARNED_AFTER times, then retires so rows get their full title width back.
 * Only successful long-presses count — tapping the button never advances it,
 * or the training wheels would come off without her having learned anything.
 */
export function shouldShowMenuButton(pref: MenuButtonPref, longPressCount: number): boolean {
  if (pref === "always") return true;
  if (pref === "never") return false;
  return longPressCount < LEARNED_AFTER;
}

/** Whether the "hold a song to open this" footer still appears inside the menu. */
export function shouldShowLongPressTip(
  pref: MenuButtonPref,
  longPressCount: number,
  isTouch: boolean,
): boolean {
  if (!isTouch) return false;
  if (pref === "never") return false;
  return longPressCount < LEARNED_AFTER;
}

// ─── Browser-facing wrappers ────────────────────────────────────────────────
// Every one of these is a no-op during SSR and degrades to a sane default if
// localStorage throws (Safari private mode has historically done exactly that).

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode, quota — the feature degrades, it doesn't break */
  }
}

export function readMenuButtonPref(): MenuButtonPref {
  const raw = readStorage(MENU_BUTTON_PREF_KEY);
  return isMenuButtonPref(raw) ? raw : "until-learned";
}

export function writeMenuButtonPref(pref: MenuButtonPref): void {
  writeStorage(MENU_BUTTON_PREF_KEY, pref);
}

export function readLongPressCount(): number {
  const n = Number(readStorage(LONGPRESS_COUNT_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function bumpLongPressCount(): number {
  const next = readLongPressCount() + 1;
  writeStorage(LONGPRESS_COUNT_KEY, String(next));
  return next;
}

export function readCoachSeen(): boolean {
  return readStorage(COACH_LONGPRESS_KEY) === "1";
}

export function markCoachSeen(): void {
  writeStorage(COACH_LONGPRESS_KEY, "1");
}

export function readInstallHintDismissed(): boolean {
  return readStorage(INSTALL_HINT_KEY) === "1";
}

export function markInstallHintDismissed(): void {
  writeStorage(INSTALL_HINT_KEY, "1");
}

/** Live check against the real browser globals. Safe to call during SSR. */
export function detectShouldShowInstallHint(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return shouldShowInstallHint({
    nav: navigator as unknown as NavigatorLike,
    matchMedia: window.matchMedia ? (q: string) => window.matchMedia(q) : undefined,
    dismissed: readInstallHintDismissed(),
  });
}

/**
 * Coarse pointer — the thing that actually decides whether hover exists.
 *
 * Deliberately not a width check: an iPad in landscape is wider than 767px but
 * still has no hover, and that is the case where a hover-only control silently
 * becomes unreachable.
 */
export function detectIsTouch(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}
