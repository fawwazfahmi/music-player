// Per-user YouTube cookie jars.
//
// A YouTube Mix is personalized by the *session*, not the URL: the RD list id
// encodes only the seed video, so an anonymous yt-dlp fetch gets a cold-start
// generic radio rather than the mix the user actually saw. Handing yt-dlp a
// logged-in cookie jar is the only thing that restores real personalization.
//
// Read this before touching anything here:
//
//   • A YouTube cookies.txt contains LIVE GOOGLE ACCOUNT CREDENTIALS
//     (__Secure-1PSID, SAPISID, …). Anyone holding the file can act as that
//     Google account, and the values cannot be scoped down to YouTube only.
//   • scripts/backup.sh pg_dumps the database AND tars MUSIC_LIBRARY_PATH,
//     and both are mirrored offsite. Jars therefore live in NEITHER — see
//     the assertion in resolveCookiesDir().
//   • mu_name is an unsigned plain cookie (see auth.ts). Per-user jars are a
//     convenience boundary, not an isolation boundary: either person can
//     select the other's jar by editing that cookie. Both already share the
//     app password, so this is a deliberate, accepted trade.
//   • Never log jar contents, and scrub paths out of yt-dlp stderr before it
//     reaches a log line or an errorMessage column.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";
import { NAME_COOKIE_NAME, isValidName, type AppUserName } from "@/server/auth";

/** Cookie names that indicate a real logged-in YouTube session. A jar
    carrying only PREF/VISITOR_INFO1_LIVE is an anonymous jar and buys us
    nothing, so we reject it rather than let the user think it worked. */
const SESSION_COOKIE_NAMES = [
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "LOGIN_INFO",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "__Secure-1PAPISID",
  "__Secure-3PAPISID",
];

const STALE_PATTERNS = [
  /sign in to confirm/i,
  /please sign ?in/i,
  /requires login/i,
  /cookies are no longer valid/i,
  /login required/i,
  /account cookies are invalid/i,
];

function resolveCookiesDir(): string {
  const dir =
    env.YT_COOKIES_DIR ??
    path.join(os.homedir(), ".config", "music-universe", "yt-cookies");
  const resolved = path.resolve(dir);
  const library = path.resolve(env.MUSIC_LIBRARY_PATH);
  // path.relative gives a non-".."-prefixed, non-absolute result exactly when
  // `resolved` sits inside `library`.
  const rel = path.relative(library, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(
      "YT_COOKIES_DIR must not be inside MUSIC_LIBRARY_PATH — scripts/backup.sh " +
        "archives that directory and mirrors it offsite, which would leak live " +
        "Google session credentials.",
    );
  }
  return resolved;
}

export function cookiePathFor(name: AppUserName): string {
  return path.join(resolveCookiesDir(), `${name}.txt`);
}

function stalePathFor(name: AppUserName): string {
  return path.join(resolveCookiesDir(), `${name}.stale`);
}

export type CookieValidation = { ok: true } | { ok: false; reason: string };

export function validateNetscapeCookies(text: string): CookieValidation {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "The file is empty." };
  if (/^\s*</.test(trimmed)) {
    return { ok: false, reason: "That looks like an HTML page, not a cookies.txt." };
  }

  const lines = trimmed.split(/\r?\n/);
  const hasHeader = lines.some((l) => /^#\s*(Netscape\s+)?HTTP Cookie File/i.test(l.trim()));
  if (!hasHeader) {
    return {
      ok: false,
      reason: "Missing the '# Netscape HTTP Cookie File' header line.",
    };
  }

  let sawYoutubeSession = false;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const domain = parts[0]!.toLowerCase();
    const cookieName = parts[5]!;
    if (!domain.includes("youtube.com") && !domain.includes("google.com")) continue;
    if (SESSION_COOKIE_NAMES.includes(cookieName)) {
      sawYoutubeSession = true;
      break;
    }
  }
  if (!sawYoutubeSession) {
    return {
      ok: false,
      reason:
        "No YouTube session cookie found. Make sure you were signed in to YouTube when you exported.",
    };
  }
  return { ok: true };
}

export async function saveCookies(name: AppUserName, text: string): Promise<void> {
  const validation = validateNetscapeCookies(text);
  if (!validation.ok) throw new Error(validation.reason);

  const dir = resolveCookiesDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // mode on writeFile only applies at creation, so chmod explicitly to cover
  // the overwrite-an-existing-jar case too.
  await fs.writeFile(cookiePathFor(name), text, { mode: 0o600 });
  await fs.chmod(cookiePathFor(name), 0o600);
  await fs.rm(stalePathFor(name), { force: true });
}

export async function removeCookies(name: AppUserName): Promise<void> {
  await fs.rm(cookiePathFor(name), { force: true });
  await fs.rm(stalePathFor(name), { force: true });
}

export async function markStale(name: AppUserName): Promise<void> {
  const dir = resolveCookiesDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(stalePathFor(name), "", { mode: 0o600 });
}

export type CookieStatus = "none" | "connected" | "stale";

export async function cookieStatus(name: AppUserName): Promise<CookieStatus> {
  const exists = await fs
    .stat(cookiePathFor(name))
    .then(() => true)
    .catch(() => false);
  if (!exists) return "none";
  const stale = await fs
    .stat(stalePathFor(name))
    .then(() => true)
    .catch(() => false);
  return stale ? "stale" : "connected";
}

/**
 * Path to hand yt-dlp, or null to run anonymously. A stale jar returns null:
 * passing it would fail every fetch, and an anonymous result — mediocre but
 * present — beats a hard error.
 */
export async function readCookiePath(name: AppUserName): Promise<string | null> {
  const status = await cookieStatus(name);
  return status === "connected" ? cookiePathFor(name) : null;
}

export interface CookieBearingRequest {
  cookies: { get(name: string): { value: string } | undefined };
}

/** Which of the two identities is calling, per the mu_name cookie. */
export function identityFromRequest(req: CookieBearingRequest): AppUserName | null {
  const raw = req.cookies.get(NAME_COOKIE_NAME)?.value;
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  return isValidName(decoded) ? decoded : null;
}

/** Resolve the caller's jar from the mu_name identity cookie. */
export async function cookiePathForRequest(
  req: CookieBearingRequest,
): Promise<string | null> {
  const name = identityFromRequest(req);
  return name ? readCookiePath(name) : null;
}

export function isStaleError(message: string): boolean {
  return STALE_PATTERNS.some((p) => p.test(message));
}

/**
 * Remove cookie-jar paths from a message before it is logged or persisted.
 * The path itself isn't a secret, but it points straight at a file full of
 * live credentials — no reason to write it into logs or the database.
 */
export function scrubCookiePaths(message: string): string {
  let out = message.replace(/--cookies\s+\S+/g, "--cookies <redacted>");
  let dir: string;
  try {
    dir = resolveCookiesDir();
  } catch {
    return out;
  }
  const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  out = out.replace(new RegExp(`${escaped}[^\\s]*`, "g"), "<redacted>");
  return out;
}
