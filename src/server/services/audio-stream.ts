export type Range = { start: number; end: number };
export type RangeResult = Range | { error: "invalid" } | null;

export function parseRange(header: string | undefined | null, fileSize: number): RangeResult {
  if (!header) return null;
  if (!header.startsWith("bytes=")) return { error: "invalid" };
  const spec = header.slice("bytes=".length).split(",")[0]?.trim();
  if (!spec) return { error: "invalid" };
  const [startStr, endStr] = spec.split("-");
  if (startStr === undefined || endStr === undefined) return { error: "invalid" };

  if (startStr === "" && endStr === "") return { error: "invalid" };

  if (startStr === "" && endStr !== "") {
    // suffix: last N bytes
    const n = Number(endStr);
    if (!Number.isFinite(n) || n <= 0) return { error: "invalid" };
    const start = Math.max(0, fileSize - n);
    return { start, end: fileSize - 1 };
  }

  const start = Number(startStr);
  if (!Number.isFinite(start) || start < 0) return { error: "invalid" };
  if (start >= fileSize) return { error: "invalid" };

  if (endStr === "") return { start, end: fileSize - 1 };

  const end = Math.min(Number(endStr), fileSize - 1);
  if (!Number.isFinite(end) || end < start) return { error: "invalid" };
  return { start, end };
}
