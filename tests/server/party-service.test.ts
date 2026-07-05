import { describe, expect, it } from "vitest";
import { IDLE_TIMEOUT_MS, isPartyIdle } from "@/server/services/party-service";

describe("isPartyIdle", () => {
  it("is false right after playing", () => {
    const now = Date.now();
    expect(isPartyIdle(new Date(now), now)).toBe(false);
  });

  it("is false just under the timeout", () => {
    const now = Date.now();
    expect(isPartyIdle(new Date(now - (IDLE_TIMEOUT_MS - 1000)), now)).toBe(false);
  });

  it("is true just over the timeout", () => {
    const now = Date.now();
    expect(isPartyIdle(new Date(now - (IDLE_TIMEOUT_MS + 1000)), now)).toBe(true);
  });
});
