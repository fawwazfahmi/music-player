import { describe, expect, it } from "vitest";
import { readTrackMetadata } from "@/server/services/id3-reader";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

describe("id3-reader", () => {
  it("falls back to filename + unknown for an unknown file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mu-id3-"));
    const file = path.join(dir, "Random Title.m4a");
    await fs.writeFile(file, Buffer.alloc(8));
    const meta = await readTrackMetadata(file);
    expect(meta.title).toBe("Random Title");
    expect(meta.artistName).toBe("Unknown Artist");
    expect(meta.albumTitle).toBe("Unknown Album");
    expect(meta.durationSec).toBeGreaterThanOrEqual(0);
    expect(meta.fileFormat).toBe("m4a");
    await fs.rm(dir, { recursive: true });
  });

  it("strips file extension from filename fallback", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mu-id3-"));
    const file = path.join(dir, "Some Song.mp3");
    await fs.writeFile(file, Buffer.alloc(8));
    const meta = await readTrackMetadata(file);
    expect(meta.title).toBe("Some Song");
    expect(meta.fileFormat).toBe("mp3");
    await fs.rm(dir, { recursive: true });
  });
});
