import { describe, expect, it } from "vitest";
import { displayName } from "@/lib/display-name";

describe("displayName", () => {
  it("shows ainul as Kyo (display only — identity stays ainul)", () => {
    expect(displayName("ainul")).toBe("Kyo");
  });

  it("shows fawwaz as Fawwaz", () => {
    expect(displayName("fawwaz")).toBe("Fawwaz");
  });

  it("capitalizes any other name as a fallback", () => {
    expect(displayName("someone")).toBe("Someone");
  });
});
