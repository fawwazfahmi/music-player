import { describe, expect, it, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
  process.env.MUSIC_LIBRARY_PATH = "/srv/music";
  process.env.YT_DLP_PATH = "/usr/local/bin/yt-dlp";
  process.env.FFMPEG_PATH = "/usr/local/bin/ffmpeg";
  process.env.MUSICBRAINZ_USER_AGENT = "Test/1.0";
  process.env.APP_PASSWORD_HASH = "$2b$12$Vk8M5p0K5g8M5p0K5g8M5OdT9bWGV4qjqK1qjqK1qjqK1qjqK1qj"; // bogus structure
  process.env.COOKIE_SECRET = "x".repeat(64);
});

describe("signCookie / verifyCookie", () => {
  it("round-trips a payload", async () => {
    const { signCookie, verifyCookie } = await import("@/server/auth");
    const value = signCookie("ok");
    expect(verifyCookie(value)).toBe("ok");
  });

  it("returns null for tampered values", async () => {
    const { signCookie, verifyCookie } = await import("@/server/auth");
    const value = signCookie("ok");
    const tampered = value.slice(0, -2) + "ZZ";
    expect(verifyCookie(tampered)).toBeNull();
  });

  it("returns null for nonsense", async () => {
    const { verifyCookie } = await import("@/server/auth");
    expect(verifyCookie("not-even-a-cookie")).toBeNull();
  });
});

describe("verifyPassword", () => {
  it("returns true for the correct password", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    process.env.APP_PASSWORD_HASH = bcrypt.hashSync("hunter2", 4);
    const { verifyPassword } = await import("@/server/auth?match");
    expect(await verifyPassword("hunter2")).toBe(true);
  });

  it("returns false for the wrong password", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    process.env.APP_PASSWORD_HASH = bcrypt.hashSync("hunter2", 4);
    const { verifyPassword } = await import("@/server/auth?mismatch");
    expect(await verifyPassword("wrong")).toBe(false);
  });
});
