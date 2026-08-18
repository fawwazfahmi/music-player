import { describe, expect, it } from "vitest";
import { buildDownloadArgs } from "@/server/services/yt-service";

describe("buildDownloadArgs", () => {
  const args = buildDownloadArgs("abc123", "/cache/yt");

  it("extracts m4a audio to the video-id template", () => {
    expect(args).toContain("https://www.youtube.com/watch?v=abc123");
    expect(args).toContain("-x");
    expect(args).toContain("m4a");
    expect(args).toContain("/cache/yt/abc123.%(ext)s");
  });

  it("includes retry + backoff flags so a transient 403/throttle self-recovers", () => {
    expect(args).toContain("--retries");
    expect(args).toContain("--fragment-retries");
    expect(args).toContain("--sleep-requests");
  });

  // The default yt-dlp client (android_vr) now serves PO-token-gated media URLs
  // that hard-403 on the fetch — retries can't recover it because every attempt
  // hits the same forbidden URL. Pinning non-gated player clients (web_embedded
  // first, then tv_simply/mweb fallbacks) is what actually gets bytes.
  it("pins non-gated player clients so the media fetch doesn't 403", () => {
    const i = args.indexOf("--extractor-args");
    expect(i).toBeGreaterThanOrEqual(0);
    const val = args[i + 1]!;
    expect(val).toMatch(/^youtube:player_client=/);
    expect(val).toContain("web_embedded");
    // Must NOT fall back to the 403-gated default client.
    expect(val).not.toContain("android_vr");
  });
});
