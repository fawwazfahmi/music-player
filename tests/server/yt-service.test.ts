import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("youtube-sr", () => ({
  default: { search: vi.fn() },
}));

beforeEach(() => {
  vi.resetModules();
  process.env.MUSICBRAINZ_USER_AGENT = "Test/1.0";
  process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
  process.env.MUSIC_LIBRARY_PATH = "/srv/music";
  process.env.YT_DLP_PATH = "/usr/local/bin/yt-dlp";
  process.env.FFMPEG_PATH = "/usr/local/bin/ffmpeg";
  process.env.APP_PASSWORD_HASH = "$2b$12$abcdefghijklmnopqrstuv";
  process.env.COOKIE_SECRET = "x".repeat(48);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

describe("yt-service", () => {
  it("searchYt maps youtube-sr Video[] to our YtSearchResult", async () => {
    const yt = await import("youtube-sr");
    vi.mocked(yt.default.search).mockResolvedValueOnce([
      {
        id: "vid1",
        title: "From The Start",
        channel: { name: "Laufey" },
        duration: 196000, // milliseconds!
        thumbnail: { url: "http://x/y.jpg" },
      },
      {
        id: "vid2",
        title: "From The Start (Live)",
        channel: { name: "Laufey Live" },
        duration: 200000,
        thumbnail: null,
      },
    ] as never);

    const { searchYt } = await import("@/server/services/yt-service");
    const results = await searchYt("from the start", 2);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      videoId: "vid1",
      title: "From The Start",
      uploader: "Laufey",
      duration: 196,
      thumbnail: "http://x/y.jpg",
    });
    expect(results[1]?.duration).toBe(200);
  });

  it("searchYt handles missing optional fields gracefully", async () => {
    const yt = await import("youtube-sr");
    vi.mocked(yt.default.search).mockResolvedValueOnce([
      { id: "vidx", title: "Something" } as never,
    ]);

    const { searchYt } = await import("@/server/services/yt-service");
    const results = await searchYt("x", 1);
    expect(results[0]).toMatchObject({
      videoId: "vidx",
      title: "Something",
      uploader: "Unknown",
      duration: 0,
      thumbnail: null,
    });
  });

  it("resolveDirectUrl returns the first stdout line from yt-dlp", async () => {
    const cp = await import("node:child_process");
    const fakeProc = makeFakeProc();
    vi.mocked(cp.spawn).mockReturnValueOnce(fakeProc as never);

    const { resolveDirectUrl } = await import("@/server/services/yt-service");
    const promise = resolveDirectUrl("abc123");

    fakeProc.stdout.emit("data", Buffer.from("https://rr3---sn-foo.googlevideo.com/videoplayback?xyz\n"));
    fakeProc.emit("close", 0);

    const url = await promise;
    expect(url).toMatch(/^https:\/\/rr3/);
  });

  it("resolveDirectUrl rejects on yt-dlp non-zero exit", async () => {
    const cp = await import("node:child_process");
    const fakeProc = makeFakeProc();
    vi.mocked(cp.spawn).mockReturnValueOnce(fakeProc as never);

    const { resolveDirectUrl } = await import("@/server/services/yt-service");
    const promise = resolveDirectUrl("bad");
    fakeProc.stderr.emit("data", Buffer.from("ERROR: gone\n"));
    fakeProc.emit("close", 1);
    await expect(promise).rejects.toThrow(/yt-dlp/);
  });
});
