import { describe, expect, it } from "vitest";
import { weaveEphemeral } from "@/lib/weave-queue";
import type { QueueTrack } from "@/stores/player-store";

const q = (id: string, ephemeral = false): QueueTrack => ({
  id,
  title: id,
  duration: 1,
  artist: "a",
  album: "b",
  ephemeral,
});

describe("weaveEphemeral", () => {
  it("inserts every pick and preserves base order", () => {
    const base = [q("1"), q("2"), q("3"), q("4")];
    const out = weaveEphemeral(base, [q("y1", true), q("y2", true)], () => 0.5);
    expect(out.length).toBe(6);
    expect(out.filter((t) => !t.ephemeral).map((t) => t.id)).toEqual(["1", "2", "3", "4"]);
    expect(out.filter((t) => t.ephemeral).map((t) => t.id).sort()).toEqual(["y1", "y2"]);
  });

  it("never inserts at index 0 (a known library track always starts)", () => {
    const out = weaveEphemeral([q("1"), q("2")], [q("y", true)], () => 0);
    expect(out[0]!.ephemeral).toBe(false);
  });

  it("is a no-op with no picks and returns a fresh array", () => {
    const base = [q("1")];
    const out = weaveEphemeral(base, [], () => 0.5);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });
});
