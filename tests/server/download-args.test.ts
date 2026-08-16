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
});
