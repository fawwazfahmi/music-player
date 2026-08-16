import { describe, expect, it } from "vitest";
import { audioMoodScores, blendSeedScores } from "@/server/services/audio-analysis";

describe("audioMoodScores", () => {
  it("maps model outputs to our mood axes", () => {
    const s = audioMoodScores({
      mood_happy: 0.9,
      mood_sad: 0.1,
      mood_relaxed: 0.8,
      mood_aggressive: 0.1,
      mood_party: 0.1,
      danceability: 0.2,
    });
    expect(s.happy).toBeCloseTo(0.9);
    expect(s.sad).toBeCloseTo(0.1);
    expect(s.chill).toBeCloseTo(0.8);
    // energetic = 0.4*dance + 0.3*aggressive + 0.3*party
    expect(s.energetic).toBeCloseTo(0.4 * 0.2 + 0.3 * 0.1 + 0.3 * 0.1);
    // focus = relaxed * (1 - danceability)
    expect(s.focus).toBeCloseTo(0.8 * (1 - 0.2));
    // audio is not confident about these → absent
    expect(s.romantic).toBeUndefined();
    expect(s.nostalgic).toBeUndefined();
  });

  it("a dance banger reads energetic, not chill", () => {
    const s = audioMoodScores({
      mood_happy: 0.6,
      mood_sad: 0.3,
      mood_relaxed: 0.2,
      mood_aggressive: 0.7,
      mood_party: 0.8,
      danceability: 0.9,
    });
    expect(s.energetic).toBeGreaterThan(0.7);
    expect(s.focus).toBeLessThan(0.1); // dancey → not focus
  });
});

describe("blendSeedScores", () => {
  it("audio is weighted over the LLM where both have a mood", () => {
    const merged = blendSeedScores(
      { chill: 0.5, romantic: 0.7 },
      { chill: 0.9, energetic: 0.8 },
    );
    expect(merged.chill).toBeCloseTo(0.6 * 0.9 + 0.4 * 0.5);
    expect(merged.romantic).toBeCloseTo(0.7); // llm only
    expect(merged.energetic).toBeCloseTo(0.8); // audio only
  });

  it("clamps to [0,1] and drops zeros-only gracefully", () => {
    const merged = blendSeedScores({}, {});
    expect(Object.keys(merged)).toHaveLength(0);
  });
});
