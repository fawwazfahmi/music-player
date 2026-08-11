import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

beforeEach(async () => {
  vi.resetModules();
  // The spawn mock is module-level and survives resetModules, so its call
  // log would leak between tests and make args() read a previous test's
  // invocation. Reset it (not just clear) so queued once-impls go too.
  const cp = await import("node:child_process");
  vi.mocked(cp.spawn).mockReset();
  process.env.MUSICBRAINZ_USER_AGENT = "Test/1.0";
  process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
  process.env.MUSIC_LIBRARY_PATH = "/srv/music";
  process.env.YT_DLP_PATH = "/usr/local/bin/yt-dlp";
  process.env.FFMPEG_PATH = "/usr/local/bin/ffmpeg";
  process.env.APP_PASSWORD_HASH = "$2b$12$abcdefghijklmnopqrstuv";
  process.env.COOKIE_SECRET = "x".repeat(48);
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

/** Drive a mocked yt-dlp run to completion with the given JSON payload. */
async function respondWith(payload: unknown) {
  const cp = await import("node:child_process");
  const proc = makeFakeProc();
  vi.mocked(cp.spawn).mockReturnValueOnce(proc as never);
  return {
    proc,
    finish: async () => {
      await vi.waitFor(() => expect(cp.spawn).toHaveBeenCalled());
      proc.stdout.emit("data", Buffer.from(JSON.stringify(payload)));
      proc.emit("close", 0);
    },
    args: () => vi.mocked(cp.spawn).mock.calls[0]?.[1] as string[],
  };
}

function entry(id: string, title = `title-${id}`) {
  return { id, title, uploader: "Chan", duration: 180, thumbnail: null };
}

describe("classifyListUrl", () => {
  it("classifies every RD-family prefix as a mix", async () => {
    const { classifyListUrl } = await import("@/server/services/yt-list");
    for (const id of ["RDabc123", "RDMMabc123", "RDAMVMabc123", "RDEMabc123"]) {
      expect(classifyListUrl(`https://www.youtube.com/watch?v=x&list=${id}`)).toEqual({
        kind: "mix",
        listId: id,
      });
    }
  });

  it("classifies curated list ids as playlists", async () => {
    const { classifyListUrl } = await import("@/server/services/yt-list");
    for (const id of ["PLabc123", "OLAK5uy_abc123", "UUabc123"]) {
      expect(classifyListUrl(`https://www.youtube.com/playlist?list=${id}`)).toEqual({
        kind: "playlist",
        listId: id,
      });
    }
  });

  it("returns null without a list param, on junk, or off-site", async () => {
    const { classifyListUrl } = await import("@/server/services/yt-list");
    expect(classifyListUrl("https://www.youtube.com/watch?v=x")).toBeNull();
    expect(classifyListUrl("not a url")).toBeNull();
    expect(classifyListUrl("https://evil.example.com/watch?list=PLabc")).toBeNull();
    expect(classifyListUrl("http://localhost:5432/?list=PLabc")).toBeNull();
  });

  it("accepts youtu.be and m.youtube.com", async () => {
    const { classifyListUrl } = await import("@/server/services/yt-list");
    expect(classifyListUrl("https://youtu.be/x?list=PLabc")?.kind).toBe("playlist");
    expect(classifyListUrl("https://m.youtube.com/watch?v=x&list=RDabc")?.kind).toBe("mix");
  });
});

describe("previewList", () => {
  it("bounds a mix with --playlist-end and pre-checks only the first 20", async () => {
    const r = await respondWith({
      title: "Mix - Something",
      entries: Array.from({ length: 40 }, (_, i) => entry(`v${i}`)),
    });
    const { previewList } = await import("@/server/services/yt-list");
    const promise = previewList("https://www.youtube.com/watch?v=x&list=RDabc");
    await r.finish();
    const preview = await promise;

    expect(r.args()).toContain("--playlist-end");
    expect(r.args()[r.args().indexOf("--playlist-end") + 1]).toBe("40");
    expect(preview.kind).toBe("mix");
    expect(preview.tracks).toHaveLength(40);
    expect(preview.defaultCheckedCount).toBe(20);
    expect(preview.title).toBe("Mix - Something");
  });

  it("does not bound a playlist and pre-checks all of it", async () => {
    const r = await respondWith({
      title: "My Album",
      entries: Array.from({ length: 60 }, (_, i) => entry(`p${i}`)),
    });
    const { previewList } = await import("@/server/services/yt-list");
    const promise = previewList("https://www.youtube.com/playlist?list=PLabc");
    await r.finish();
    const preview = await promise;

    expect(r.args()).not.toContain("--playlist-end");
    expect(preview.kind).toBe("playlist");
    expect(preview.tracks).toHaveLength(60);
    expect(preview.defaultCheckedCount).toBe(60);
  });

  it("dedupes mix entries by videoId, preserving first occurrence", async () => {
    const r = await respondWith({
      title: "Mix",
      entries: [entry("a"), entry("b"), entry("a"), entry("c"), entry("b")],
    });
    const { previewList } = await import("@/server/services/yt-list");
    const promise = previewList("https://www.youtube.com/watch?v=a&list=RDa");
    await r.finish();
    const preview = await promise;

    expect(preview.tracks.map((t) => t.videoId)).toEqual(["a", "b", "c"]);
  });

  it("keeps duplicate entries in a curated playlist", async () => {
    const r = await respondWith({
      title: "Playlist",
      entries: [entry("a"), entry("b"), entry("a")],
    });
    const { previewList } = await import("@/server/services/yt-list");
    const promise = previewList("https://www.youtube.com/playlist?list=PLa");
    await r.finish();
    const preview = await promise;

    expect(preview.tracks.map((t) => t.videoId)).toEqual(["a", "b", "a"]);
  });

  it("clamps defaultCheckedCount to list length for a short mix", async () => {
    const r = await respondWith({ title: "Mix", entries: [entry("a"), entry("b")] });
    const { previewList } = await import("@/server/services/yt-list");
    const promise = previewList("https://www.youtube.com/watch?v=a&list=RDa");
    await r.finish();
    expect((await promise).defaultCheckedCount).toBe(2);
  });

  it("passes --cookies when a cookie path is supplied, and omits it otherwise", async () => {
    const withCookies = await respondWith({ title: "Mix", entries: [entry("a")] });
    const { previewList } = await import("@/server/services/yt-list");
    const p1 = previewList("https://www.youtube.com/watch?v=a&list=RDa", {
      cookiePath: "/secrets/yt/ainul.txt",
    });
    await withCookies.finish();
    await p1;
    expect(withCookies.args()).toContain("--cookies");
    expect(withCookies.args()).toContain("/secrets/yt/ainul.txt");
  });

  it("rejects a URL that is not a YouTube list", async () => {
    const { previewList } = await import("@/server/services/yt-list");
    await expect(previewList("https://evil.example.com/?list=PLa")).rejects.toThrow(
      /not a youtube/i,
    );
  });

  it("performs no database writes", async () => {
    const trackCreate = vi.fn();
    const ytUpsert = vi.fn();
    vi.doMock("@/server/db", () => ({
      db: {
        track: { findUnique: vi.fn(), create: trackCreate, update: vi.fn() },
        ytCacheEntry: { upsert: ytUpsert },
        artist: { upsert: vi.fn() },
        album: { upsert: vi.fn() },
      },
    }));
    const r = await respondWith({ title: "Mix", entries: [entry("a"), entry("b")] });
    const { previewList } = await import("@/server/services/yt-list");
    const promise = previewList("https://www.youtube.com/watch?v=a&list=RDa");
    await r.finish();
    await promise;

    expect(trackCreate).not.toHaveBeenCalled();
    expect(ytUpsert).not.toHaveBeenCalled();
  });
});
