import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let tmpDir: string;

beforeEach(async () => {
  vi.resetModules();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mu-cookies-"));
  process.env.MUSICBRAINZ_USER_AGENT = "Test/1.0";
  process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
  process.env.MUSIC_LIBRARY_PATH = "/srv/music";
  process.env.YT_DLP_PATH = "/usr/local/bin/yt-dlp";
  process.env.FFMPEG_PATH = "/usr/local/bin/ffmpeg";
  process.env.APP_PASSWORD_HASH = "$2b$12$abcdefghijklmnopqrstuv";
  process.env.COOKIE_SECRET = "x".repeat(48);
  process.env.YT_COOKIES_DIR = tmpDir;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.YT_COOKIES_DIR;
});

const VALID_JAR = [
  "# Netscape HTTP Cookie File",
  "# This is a generated file!  Do not edit.",
  ".youtube.com\tTRUE\t/\tTRUE\t1799999999\t__Secure-1PSID\tabc123",
  ".youtube.com\tTRUE\t/\tTRUE\t1799999999\tSAPISID\tdef456",
  ".youtube.com\tTRUE\t/\tFALSE\t1799999999\tPREF\tf6=40000000",
].join("\n");

describe("validateNetscapeCookies", () => {
  it("accepts a well-formed YouTube jar", async () => {
    const { validateNetscapeCookies } = await import("@/server/services/yt-cookies");
    expect(validateNetscapeCookies(VALID_JAR)).toEqual({ ok: true });
  });

  it("rejects empty input", async () => {
    const { validateNetscapeCookies } = await import("@/server/services/yt-cookies");
    expect(validateNetscapeCookies("")).toMatchObject({ ok: false });
    expect(validateNetscapeCookies("   \n  ")).toMatchObject({ ok: false });
  });

  it("rejects an HTML page saved by mistake", async () => {
    const { validateNetscapeCookies } = await import("@/server/services/yt-cookies");
    const r = validateNetscapeCookies("<!doctype html><html><body>hi</body></html>");
    expect(r.ok).toBe(false);
  });

  it("rejects a jar with no Netscape header", async () => {
    const { validateNetscapeCookies } = await import("@/server/services/yt-cookies");
    const noHeader = ".youtube.com\tTRUE\t/\tTRUE\t1799999999\t__Secure-1PSID\tabc";
    expect(validateNetscapeCookies(noHeader)).toMatchObject({ ok: false });
  });

  it("rejects a jar with no YouTube session cookie", async () => {
    const { validateNetscapeCookies } = await import("@/server/services/yt-cookies");
    const onlyPref = [
      "# Netscape HTTP Cookie File",
      ".youtube.com\tTRUE\t/\tFALSE\t1799999999\tPREF\tf6=40000000",
    ].join("\n");
    const r = validateNetscapeCookies(onlyPref);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/session cookie/i);
  });

  it("rejects a jar for the wrong domain", async () => {
    const { validateNetscapeCookies } = await import("@/server/services/yt-cookies");
    const wrongDomain = [
      "# Netscape HTTP Cookie File",
      ".example.com\tTRUE\t/\tTRUE\t1799999999\t__Secure-1PSID\tabc",
    ].join("\n");
    expect(validateNetscapeCookies(wrongDomain)).toMatchObject({ ok: false });
  });
});

describe("cookie storage", () => {
  it("saves with owner-only permissions and reports connected", async () => {
    const m = await import("@/server/services/yt-cookies");
    await m.saveCookies("ainul", VALID_JAR);

    const stat = await fs.stat(m.cookiePathFor("ainul"));
    expect(stat.mode & 0o777).toBe(0o600);
    await expect(m.cookieStatus("ainul")).resolves.toBe("connected");
  });

  it("reports none when nothing was uploaded", async () => {
    const m = await import("@/server/services/yt-cookies");
    await expect(m.cookieStatus("fawwaz")).resolves.toBe("none");
    await expect(m.readCookiePath("fawwaz")).resolves.toBeNull();
  });

  it("keeps the two identities in separate jars", async () => {
    const m = await import("@/server/services/yt-cookies");
    await m.saveCookies("ainul", VALID_JAR);
    expect(m.cookiePathFor("ainul")).not.toBe(m.cookiePathFor("fawwaz"));
    await expect(m.cookieStatus("fawwaz")).resolves.toBe("none");
  });

  it("marks a jar stale and stops handing out its path", async () => {
    const m = await import("@/server/services/yt-cookies");
    await m.saveCookies("ainul", VALID_JAR);
    await expect(m.readCookiePath("ainul")).resolves.toBe(m.cookiePathFor("ainul"));

    await m.markStale("ainul");
    await expect(m.cookieStatus("ainul")).resolves.toBe("stale");
    // A stale jar must not be passed to yt-dlp — it would just fail every
    // fetch. Fall back to anonymous instead.
    await expect(m.readCookiePath("ainul")).resolves.toBeNull();
  });

  it("re-uploading clears the stale flag", async () => {
    const m = await import("@/server/services/yt-cookies");
    await m.saveCookies("ainul", VALID_JAR);
    await m.markStale("ainul");
    await m.saveCookies("ainul", VALID_JAR);
    await expect(m.cookieStatus("ainul")).resolves.toBe("connected");
  });

  it("removeCookies deletes the jar and the stale marker", async () => {
    const m = await import("@/server/services/yt-cookies");
    await m.saveCookies("ainul", VALID_JAR);
    await m.markStale("ainul");
    await m.removeCookies("ainul");
    await expect(m.cookieStatus("ainul")).resolves.toBe("none");
  });

  it("refuses to save an invalid jar", async () => {
    const m = await import("@/server/services/yt-cookies");
    await expect(m.saveCookies("ainul", "garbage")).rejects.toThrow();
    await expect(m.cookieStatus("ainul")).resolves.toBe("none");
  });
});

describe("backup safety", () => {
  it("refuses a cookie dir inside MUSIC_LIBRARY_PATH", async () => {
    // scripts/backup.sh tars MUSIC_LIBRARY_PATH and mirrors it offsite.
    // A jar in there would ship live Google credentials to the backup target.
    process.env.MUSIC_LIBRARY_PATH = tmpDir;
    process.env.YT_COOKIES_DIR = path.join(tmpDir, "yt-cookies");
    vi.resetModules();
    const m = await import("@/server/services/yt-cookies");
    expect(() => m.cookiePathFor("ainul")).toThrow(/MUSIC_LIBRARY_PATH/);
  });
});

describe("scrubCookiePaths", () => {
  it("strips the --cookies flag and its path from a message", async () => {
    const { scrubCookiePaths } = await import("@/server/services/yt-cookies");
    const msg = "yt-dlp exited 1: --cookies /secrets/yt/ainul.txt could not be read";
    const out = scrubCookiePaths(msg);
    expect(out).not.toContain("/secrets/yt/ainul.txt");
    expect(out).toContain("--cookies <redacted>");
  });

  it("strips any path under the cookie dir even without the flag", async () => {
    const m = await import("@/server/services/yt-cookies");
    const out = m.scrubCookiePaths(`could not read ${m.cookiePathFor("ainul")} today`);
    expect(out).not.toContain("ainul.txt");
  });

  it("leaves unrelated messages untouched", async () => {
    const { scrubCookiePaths } = await import("@/server/services/yt-cookies");
    expect(scrubCookiePaths("HTTP Error 403: Forbidden")).toBe("HTTP Error 403: Forbidden");
  });
});

describe("isStaleError", () => {
  it("recognises the login / bot-check failures that mean expired cookies", async () => {
    const { isStaleError } = await import("@/server/services/yt-cookies");
    expect(isStaleError("ERROR: Sign in to confirm you're not a bot")).toBe(true);
    expect(isStaleError("ERROR: Please sign in to view this video")).toBe(true);
    expect(isStaleError("ERROR: This video requires login")).toBe(true);
    expect(isStaleError("ERROR: The provided cookies are no longer valid")).toBe(true);
  });

  it("does not treat ordinary failures as staleness", async () => {
    const { isStaleError } = await import("@/server/services/yt-cookies");
    expect(isStaleError("HTTP Error 404: Not Found")).toBe(false);
    expect(isStaleError("Video unavailable")).toBe(false);
  });
});
