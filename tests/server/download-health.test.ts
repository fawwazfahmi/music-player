import { describe, expect, it } from "vitest";
import { interpretProbe } from "@/server/services/download-health";

describe("interpretProbe", () => {
  it("reports healthy on a successful probe", () => {
    const v = interpretProbe({ ok: true, videoId: "abc123" });
    expect(v.healthy).toBe(true);
    expect(v.body).toContain("abc123");
  });

  it("flags a 403 as the player-client regression we fixed before", () => {
    const v = interpretProbe({
      ok: false,
      videoId: "abc123",
      stderr: "ERROR: unable to download video data: HTTP Error 403: Forbidden",
    });
    expect(v.healthy).toBe(false);
    expect(v.body).toMatch(/403/);
    // Points the reader at the actual lever, not a generic "download failed".
    expect(v.body.toLowerCase()).toContain("player_client");
  });

  it("flags a non-403 failure without the player-client hint", () => {
    const v = interpretProbe({
      ok: false,
      videoId: "abc123",
      stderr: "ERROR: Video unavailable",
    });
    expect(v.healthy).toBe(false);
    expect(v.body.toLowerCase()).not.toContain("player_client");
    expect(v.body).toContain("unavailable");
  });
});
