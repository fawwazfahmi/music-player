import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmpRoot = "";

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mu-art-"));
  process.env.MUSIC_LIBRARY_PATH = tmpRoot;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("cover-art service", () => {
  it("downloads and writes the file when CAA returns 200", async () => {
    const bytes = new TextEncoder().encode("fake jpeg bytes");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer,
    } as never);

    const { fetchCoverArt } = await import("@/server/services/cover-art");
    const result = await fetchCoverArt("release-mbid-1");
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe("image/jpeg");
    expect(result?.hash).toMatch(/^[a-f0-9]{64}$/);
    // File should exist at the returned path
    const stat = await fs.stat(result!.path);
    expect(stat.size).toBe(bytes.byteLength);
  });

  it("returns null on 404 (no cover available)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as never);

    const { fetchCoverArt } = await import("@/server/services/cover-art");
    const result = await fetchCoverArt("release-mbid-missing");
    expect(result).toBeNull();
  });

  it("throws on other HTTP errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as never);

    const { fetchCoverArt } = await import("@/server/services/cover-art");
    await expect(fetchCoverArt("release-mbid-err")).rejects.toThrow(/500/);
  });

  it("uses sha256 hash as the filename so identical bytes dedupe", async () => {
    const bytes = new TextEncoder().encode("identical bytes");
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer,
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer,
      } as never);

    const { fetchCoverArt } = await import("@/server/services/cover-art");
    const a = await fetchCoverArt("a");
    const b = await fetchCoverArt("b");
    expect(a?.hash).toBe(b?.hash);
    expect(a?.path).toBe(b?.path);
  });
});
