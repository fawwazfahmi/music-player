import { describe, expect, it, beforeEach } from "vitest";

describe("env loader", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.MUSIC_LIBRARY_PATH;
    delete process.env.YT_DLP_PATH;
    delete process.env.FFMPEG_PATH;
    delete process.env.MUSICBRAINZ_USER_AGENT;
    delete process.env.APP_PASSWORD_HASH;
    delete process.env.COOKIE_SECRET;
  });

  it("throws when DATABASE_URL is missing", async () => {
    await expect(import("@/lib/env?missing-db")).rejects.toThrow(/DATABASE_URL/);
  });

  it("parses all required vars when present", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
    process.env.MUSIC_LIBRARY_PATH = "/srv/music";
    process.env.YT_DLP_PATH = "/usr/local/bin/yt-dlp";
    process.env.FFMPEG_PATH = "/usr/local/bin/ffmpeg";
    process.env.MUSICBRAINZ_USER_AGENT = "Test/1.0";
    process.env.APP_PASSWORD_HASH = "$2b$12$abcdefghijklmnopqrstuv";
    process.env.COOKIE_SECRET = "x".repeat(32);
    const { env } = await import("@/lib/env?ok");
    expect(env.DATABASE_URL).toMatch(/^postgresql/);
    expect(env.COOKIE_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("rejects COOKIE_SECRET shorter than 32 chars", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
    process.env.MUSIC_LIBRARY_PATH = "/srv/music";
    process.env.YT_DLP_PATH = "/usr/local/bin/yt-dlp";
    process.env.FFMPEG_PATH = "/usr/local/bin/ffmpeg";
    process.env.MUSICBRAINZ_USER_AGENT = "Test/1.0";
    process.env.APP_PASSWORD_HASH = "$2b$12$abcdefghijklmnopqrstuv";
    process.env.COOKIE_SECRET = "short";
    await expect(import("@/lib/env?short-secret")).rejects.toThrow(/COOKIE_SECRET/);
  });
});
