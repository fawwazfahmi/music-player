import { describe, expect, it } from "vitest";
import { parseRange } from "@/server/services/audio-stream";

describe("parseRange", () => {
  const size = 1000;

  it("returns null when header is missing", () => {
    expect(parseRange(undefined, size)).toBeNull();
    expect(parseRange(null, size)).toBeNull();
  });

  it("parses 'bytes=0-99'", () => {
    expect(parseRange("bytes=0-99", size)).toEqual({ start: 0, end: 99 });
  });

  it("parses 'bytes=500-' as start-to-end", () => {
    expect(parseRange("bytes=500-", size)).toEqual({ start: 500, end: 999 });
  });

  it("parses 'bytes=-200' as last 200 bytes", () => {
    expect(parseRange("bytes=-200", size)).toEqual({ start: 800, end: 999 });
  });

  it("clamps end to file size minus one", () => {
    expect(parseRange("bytes=0-99999", size)).toEqual({ start: 0, end: 999 });
  });

  it("returns invalid when range is unsatisfiable", () => {
    expect(parseRange("bytes=2000-3000", size)).toEqual({ error: "invalid" });
  });

  it("returns invalid for garbage", () => {
    expect(parseRange("not-a-range", size)).toEqual({ error: "invalid" });
    expect(parseRange("bytes=", size)).toEqual({ error: "invalid" });
  });
});
