import { describe, expect, it } from "vitest";
import fs from "node:fs";

/**
 * Walk the tiny subset of SVG path grammar these icons use (absolute M,
 * relative h/v/l, z) and return the drawn bounding box.
 */
function bbox(d: string) {
  const tokens = d.match(/[MmHhVvLlZz][^MmHhVvLlZz]*/g) ?? [];
  let x = 0;
  let y = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const see = () => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const t of tokens) {
    const cmd = t[0]!;
    const n = (t.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number);
    switch (cmd) {
      case "M": x = n[0]!; y = n[1]!; see(); break;
      case "h": x += n[0]!; see(); break;
      case "v": y += n[0]!; see(); break;
      case "l": x += n[0]!; y += n[1]!; see(); break;
      case "z": case "Z": break;
    }
  }
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

describe("BoltIcon", () => {
  it("is centred in its 24x24 viewBox", () => {
    // Regression: the original path started at (7,21), putting the bolt 4.5px
    // left of centre and half a pixel low — visibly off in the player bar
    // toggle and in the Performance Mode dialog.
    const src = fs.readFileSync("src/components/icons.tsx", "utf8");
    const fn = src.slice(src.indexOf("export function BoltIcon"));
    const d = /d="([^"]+)"/.exec(fn)?.[1];
    expect(d).toBeTruthy();

    const b = bbox(d!);
    expect(b.cx).toBeCloseTo(12, 5);
    expect(b.cy).toBeCloseTo(12, 5);
    // And it should still fit inside the box.
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(24);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxY).toBeLessThanOrEqual(24);
  });

  it("the bbox helper actually detects an off-centre path", () => {
    // Guard the guard: the original path must fail the centring assertion.
    const original = bbox("M7 21h-1l1 -7h-4l5 -10h1l-1 7h4z");
    expect(original.cx).toBeCloseTo(7.5, 5);
    expect(original.cy).toBeCloseTo(12.5, 5);
  });
});
