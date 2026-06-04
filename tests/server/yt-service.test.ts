import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
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
  it("searchYt parses yt-dlp -J output (entries array)", async () => {
    const cp = await import("node:child_process");
    const fakeProc = makeFakeProc();
    vi.mocked(cp.spawn).mockReturnValueOnce(fakeProc as never);

    const { searchYt } = await import("@/server/services/yt-service");
    const promise = searchYt("from the start", 2);

    fakeProc.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          entries: [
            { id: "vid1", title: "From The Start", uploader: "Laufey", duration: 196, thumbnail: "http://x/y.jpg" },
            { id: "vid2", title: "From The Start (Live)", channel: "Laufey", duration: 200 },
          ],
        }),
      ),
    );
    fakeProc.emit("close", 0);

    const results = await promise;
    expect(results).toHaveLength(2);
    expect(results[0]?.videoId).toBe("vid1");
    expect(results[0]?.title).toBe("From The Start");
    expect(results[0]?.uploader).toBe("Laufey");
    expect(results[0]?.duration).toBe(196);
    expect(results[1]?.uploader).toBe("Laufey"); // falls back to channel
  });

  it("searchYt rejects on non-zero exit", async () => {
    const cp = await import("node:child_process");
    const fakeProc = makeFakeProc();
    vi.mocked(cp.spawn).mockReturnValueOnce(fakeProc as never);

    const { searchYt } = await import("@/server/services/yt-service");
    const promise = searchYt("x", 1);
    fakeProc.stderr.emit("data", Buffer.from("ERROR: boom\n"));
    fakeProc.emit("close", 1);
    await expect(promise).rejects.toThrow(/yt-dlp/);
  });

  it("resolveDirectUrl returns the first stdout line", async () => {
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
});
