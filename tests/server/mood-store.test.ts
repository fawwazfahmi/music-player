import { beforeEach, describe, expect, it } from "vitest";

const RUN = !!process.env.DATABASE_URL;

describe.skipIf(!RUN)("mood store", () => {
  beforeEach(() => {
    // reset the in-process memo so ensure runs against the DB each test
    delete (globalThis as Record<string, unknown>).__mu_moods_ensured;
  });

  it("getAllMoods seeds the seven built-ins and is idempotent", async () => {
    const { getAllMoods } = await import("@/server/services/mood-store");
    const first = await getAllMoods();
    const builtins = first.filter((m) => m.kind === "BUILTIN");
    expect(builtins.length).toBeGreaterThanOrEqual(7);
    const chill = first.find((m) => m.name === "chill");
    expect(chill?.label).toBe("Chill");
    expect(chill?.emoji).toBe("😌");

    // Second call must not duplicate.
    delete (globalThis as Record<string, unknown>).__mu_moods_ensured;
    const second = await getAllMoods();
    expect(second.filter((m) => m.name === "chill")).toHaveLength(1);
    // Ordered by position.
    const positions = second.filter((m) => m.kind === "BUILTIN").map((m) => m.position);
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it("moodByName returns the persisted row", async () => {
    const { moodByName } = await import("@/server/services/mood-store");
    const m = await moodByName("energetic");
    expect(m?.label).toBe("Energetic");
  });
});
