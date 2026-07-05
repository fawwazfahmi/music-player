import { describe, expect, it, afterEach, beforeEach } from "vitest";
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

const RUN = !!process.env.DATABASE_URL;
// Every party this suite creates uses a startedBy beginning with this prefix,
// so afterEach can delete ONLY our rows and never touch real user parties.
const TEST_PREFIX = "test-idle-";

describe.skipIf(!RUN)("party-service lastPlayingAt refresh", () => {
  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.listeningParty.deleteMany({
      where: { startedBy: { startsWith: TEST_PREFIX } },
    });
  });

  it("updateParty refreshes lastPlayingAt when playing", async () => {
    const { db } = await import("@/server/db");
    const { updateParty } = await import("@/server/services/party-service");
    const old = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const p = await db.listeningParty.create({
      data: {
        active: true,
        startedBy: `${TEST_PREFIX}play`,
        trackId: null,
        position: 0,
        isPlaying: false,
        pulse: 0,
        lastPlayingAt: old,
      },
    });

    await updateParty({ id: p.id, trackId: null, position: 5, isPlaying: true });

    const after = await db.listeningParty.findUnique({ where: { id: p.id } });
    expect(after!.lastPlayingAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it("updateParty does NOT refresh lastPlayingAt when paused", async () => {
    const { db } = await import("@/server/db");
    const { updateParty } = await import("@/server/services/party-service");
    const old = new Date(Date.now() - 60 * 60 * 1000);
    const p = await db.listeningParty.create({
      data: {
        active: true,
        startedBy: `${TEST_PREFIX}pause`,
        trackId: null,
        position: 0,
        isPlaying: true,
        pulse: 0,
        lastPlayingAt: old,
      },
    });

    await updateParty({ id: p.id, trackId: null, position: 5, isPlaying: false });

    const after = await db.listeningParty.findUnique({ where: { id: p.id } });
    expect(after!.lastPlayingAt.getTime()).toBe(old.getTime());
  });
});

describe.skipIf(!RUN)("getActiveParty lazy idle-end", () => {
  afterEach(async () => {
    const { db } = await import("@/server/db");
    await db.listeningParty.deleteMany({
      where: { startedBy: { startsWith: TEST_PREFIX } },
    });
  });

  it("ends an idle party and does not return it", async () => {
    const { db } = await import("@/server/db");
    const { getActiveParty } = await import("@/server/services/party-service");
    // Idle: last played over the timeout ago. Newest updatedAt (created last)
    // so getActiveParty's findFirst returns THIS row.
    const stale = new Date(Date.now() - (IDLE_TIMEOUT_MS + 60_000));
    const p = await db.listeningParty.create({
      data: {
        active: true,
        startedBy: `${TEST_PREFIX}stale`,
        trackId: null,
        position: 0,
        isPlaying: true, // even "playing but frozen" (disconnected) must end
        pulse: 0,
        lastPlayingAt: stale,
      },
    });

    const res = await getActiveParty();

    expect(res?.id).not.toBe(p.id);
    const row = await db.listeningParty.findUnique({ where: { id: p.id } });
    expect(row!.active).toBe(false);
    expect(row!.endedAt).not.toBeNull();
  });

  it("keeps a fresh active party", async () => {
    const { db } = await import("@/server/db");
    const { getActiveParty } = await import("@/server/services/party-service");
    const p = await db.listeningParty.create({
      data: {
        active: true,
        startedBy: `${TEST_PREFIX}fresh`,
        trackId: null,
        position: 0,
        isPlaying: true,
        pulse: 0,
        lastPlayingAt: new Date(),
      },
    });

    const res = await getActiveParty();

    expect(res?.id).toBe(p.id);
    const row = await db.listeningParty.findUnique({ where: { id: p.id } });
    expect(row!.active).toBe(true);
  });
});
