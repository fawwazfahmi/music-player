import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("@distube/ytsr", () => ({
  default: vi.fn(),
}));

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
  it("searchYt returns parsed innertube results from ytsr", async () => {
    const ytsrMod = await import("@distube/ytsr");
    vi.mocked(ytsrMod.default).mockResolvedValueOnce({
      items: [
        {
          id: "vid1",
          name: "From The Start",
          author: { name: "Laufey" },
          duration: "3:16",
          thumbnail: "http://x/y.jpg",
        },
        {
          id: "vid2",
          name: "From The Start (Live)",
          author: { name: "Laufey Live" },
          duration: "3:20",
          thumbnail: null,
        },
      ],
    } as never);

    const { searchYt } = await import("@/server/services/yt-service");
    const results = await searchYt("from the start", 2);
    expect(results).toHaveLength(2);
    expect(results[0]?.videoId).toBe("vid1");
    expect(results[0]?.title).toBe("From The Start");
    expect(results[0]?.uploader).toBe("Laufey");
    expect(results[0]?.duration).toBe(196); // 3:16 = 196s
    expect(results[1]?.duration).toBe(200); // 3:20 = 200s
  });

  it("searchYt handles hh:mm:ss durations and missing author", async () => {
    const ytsrMod = await import("@distube/ytsr");
    vi.mocked(ytsrMod.default).mockResolvedValueOnce({
      items: [
        { id: "vidLong", name: "Long Video", author: null, duration: "1:02:30", thumbnail: null },
      ],
    } as never);

    const { searchYt } = await import("@/server/services/yt-service");
    const results = await searchYt("long", 1);
    expect(results[0]?.duration).toBe(3750); // 1*3600 + 2*60 + 30
    expect(results[0]?.uploader).toBe("Unknown");
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
