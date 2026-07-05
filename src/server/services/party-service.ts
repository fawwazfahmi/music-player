// Listening Party domain logic — kept out of the action layer so the
// API routes / actions / WhatsApp send all share one source of truth.

import { db } from "@/server/db";
import { env } from "@/lib/env";
import { sendWhatsApp } from "@/server/services/whatsapp-callmebot";

/** A party is auto-ended after this long with no *playing* activity. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** True when the party has not been playing for longer than IDLE_TIMEOUT_MS.
    Covers both "paused and walked away" and "tab closed / crashed" — in both
    cases lastPlayingAt stops advancing. */
export function isPartyIdle(lastPlayingAt: Date, now: number = Date.now()): boolean {
  return now - lastPlayingAt.getTime() > IDLE_TIMEOUT_MS;
}

export interface PartyView {
  id: string;
  active: boolean;
  startedBy: string;
  trackId: string | null;
  position: number;
  isPlaying: boolean;
  pulse: number;
  startedAt: string;
  /** Milliseconds between when this state was written by the broadcaster
      and when the server is responding to the receiver's poll. Lets the
      client compute the broadcaster's *current* position rather than the
      stale one it received. */
  ageMs: number;
  // ── Track metadata snapshot ───────────────────────────────────────────
  // The broadcaster's PATCH only carries trackId; the receiver still needs
  // the title / artist / cover / ytVideoId to actually render a Now Playing
  // tile. Server enriches on emit by looking up the Track row (cached by
  // trackId so we don't hammer the DB while the same song is playing).
  trackTitle: string | null;
  trackArtist: string | null;
  trackCoverArtHash: string | null;
  trackYtVideoId: string | null;
  /** Names currently in follow mode. The broadcaster renders this in her
      banner so she can see who's actually listening with her. */
  followers: string[];
}

interface TrackSnapshot {
  trackTitle: string | null;
  trackArtist: string | null;
  trackCoverArtHash: string | null;
  trackYtVideoId: string | null;
}

// Module-level cache so we look up a track in PG only when the broadcaster
// actually changes songs, not on every 500ms PATCH. Keyed by trackId.
let cachedTrack: { id: string; snap: TrackSnapshot } | null = null;

async function loadTrackSnapshot(trackId: string | null): Promise<TrackSnapshot> {
  if (!trackId) {
    return {
      trackTitle: null,
      trackArtist: null,
      trackCoverArtHash: null,
      trackYtVideoId: null,
    };
  }
  if (cachedTrack && cachedTrack.id === trackId) return cachedTrack.snap;
  const row = await db.track.findUnique({
    where: { id: trackId },
    select: {
      title: true,
      ytVideoId: true,
      primaryArtist: { select: { name: true } },
      album: { select: { coverArtHash: true } },
    },
  });
  const snap: TrackSnapshot = {
    trackTitle: row?.title ?? null,
    trackArtist: row?.primaryArtist.name ?? null,
    trackCoverArtHash: row?.album?.coverArtHash ?? null,
    trackYtVideoId: row?.ytVideoId ?? null,
  };
  cachedTrack = { id: trackId, snap };
  return snap;
}

function toView(
  row: {
    id: string;
    active: boolean;
    startedBy: string;
    trackId: string | null;
    position: number;
    isPlaying: boolean;
    pulse: number;
    startedAt: Date;
    updatedAt: Date;
  },
  snap: TrackSnapshot,
): PartyView {
  return {
    id: row.id,
    active: row.active,
    startedBy: row.startedBy,
    trackId: row.trackId,
    position: row.position,
    isPlaying: row.isPlaying,
    pulse: row.pulse,
    startedAt: row.startedAt.toISOString(),
    ageMs: Math.max(0, Date.now() - row.updatedAt.getTime()),
    ...snap,
    followers: followerList(),
  };
}

// ───── In-memory follower roster ──────────────────────────────────────────
// Tracks who is currently in 'following' mode (hard-locked to the
// broadcaster). Just a Set<name> in module memory — resets if the Node
// process restarts, which is fine: clients will re-follow on reconnect.
const followers = new Set<string>();

function followerList(): string[] {
  return Array.from(followers).sort();
}

function clearFollowers() {
  followers.clear();
}

export async function followParty(name: string): Promise<void> {
  if (!name) return;
  followers.add(name);
  // Re-emit so the broadcaster sees an updated roster immediately.
  const view = await getActiveParty();
  emit(view);
}

export async function unfollowParty(name: string): Promise<void> {
  if (!name) return;
  followers.delete(name);
  const view = await getActiveParty();
  emit(view);
}

// ───── In-memory pub-sub for SSE subscribers ──────────────────────────────
// Module-level registry of currently-connected receivers. Each subscribe
// callback receives the latest PartyView (with fresh ageMs computed at
// emit time, never stale) whenever it changes.
//
// Lives in this Node process only. There's just one prod worker so there's
// no need for Redis / cross-process broadcasting.

type PartySubscriber = (view: PartyView | null) => void;
const subscribers = new Set<PartySubscriber>();

export function subscribeToParty(cb: PartySubscriber): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function emit(view: PartyView | null) {
  for (const cb of subscribers) {
    try {
      cb(view);
    } catch (err) {
      console.error("[mu] party emit error", err);
      subscribers.delete(cb);
    }
  }
}

/** End any currently-active parties. Idempotent. */
async function endAllActive() {
  await db.listeningParty.updateMany({
    where: { active: true },
    data: { active: false, endedAt: new Date() },
  });
}

export async function getActiveParty(): Promise<PartyView | null> {
  const row = await db.listeningParty.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return null;
  // Lazy idle cleanup: any read of party state also reaps a party that has
  // gone quiet too long (paused-and-gone, or tab closed / crashed). endParty
  // flips active=false, clears followers, and emits null to subscribers.
  if (isPartyIdle(row.lastPlayingAt)) {
    await endParty(row.id);
    return null;
  }
  const snap = await loadTrackSnapshot(row.trackId);
  return toView(row, snap);
}

export interface StartPartyInput {
  startedBy: string;
  trackId: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
  position: number;
  isPlaying: boolean;
}

export async function startParty(input: StartPartyInput): Promise<PartyView> {
  await endAllActive();
  // Fresh party = fresh roster. Avoids ghost followers from a previous
  // party staying 'in the list' after ainul ends and restarts.
  clearFollowers();
  const created = await db.listeningParty.create({
    data: {
      active: true,
      startedBy: input.startedBy,
      trackId: input.trackId,
      position: input.position,
      isPlaying: input.isPlaying,
      pulse: 1,
      // Fresh party gets a full idle grace window even while she's still
      // picking the first song (paused).
      lastPlayingAt: new Date(),
    },
  });
  const snap = await loadTrackSnapshot(created.trackId);
  const view = toView(created, snap);
  emit(view);

  // Fire WhatsApp notification — never block the party creation on this.
  // CallMeBot can take 5-15s and may fail entirely; the party should still
  // exist locally either way.
  void notifyPartyStart({
    title: input.trackTitle,
    artist: input.trackArtist,
    partyId: created.id,
  });

  return view;
}

async function notifyPartyStart(opts: {
  title: string | null;
  artist: string | null;
  partyId: string;
}) {
  const joinUrl = `${env.PUBLIC_APP_URL}/?party=${opts.partyId}`;
  const trackLine = opts.title
    ? `${opts.title}${opts.artist ? ` — ${opts.artist}` : ""}`
    : "(picking a song)";
  const text = `🎧 ainul started a listening party
${trackLine}
Join: ${joinUrl}`;
  await sendWhatsApp(text);
}

export async function endParty(id: string): Promise<void> {
  await db.listeningParty.updateMany({
    where: { id, active: true },
    data: { active: false, endedAt: new Date() },
  });
  clearFollowers();
  // Tell every SSE subscriber that the party is over so receivers can leave
  // follow mode immediately instead of waiting for their next poll.
  emit(null);
}

/** Sweep: end every active party idle past the timeout. Used by both the
    background sweeper and boot-time crash cleanup. Idempotent. Returns the
    number ended. */
export async function endIdleParties(): Promise<number> {
  const cutoff = new Date(Date.now() - IDLE_TIMEOUT_MS);
  const { count } = await db.listeningParty.updateMany({
    where: { active: true, lastPlayingAt: { lt: cutoff } },
    data: { active: false, endedAt: new Date() },
  });
  if (count > 0) {
    clearFollowers();
    emit(null);
  }
  return count;
}

// Guard so the sweeper can only run once per process (same pattern as the
// library scanner's activeWatcher). Lives in this single Node worker.
let idleSweeper: ReturnType<typeof setInterval> | null = null;

/** Start the background idle sweep: once on boot (clears a party left active
    by a crash) then every 60s. Safe to call multiple times. */
export function startPartyIdleSweeper(): void {
  if (idleSweeper) return;
  const sweep = () =>
    void endIdleParties().catch((err) =>
      console.error("[mu] party idle sweep failed", err),
    );
  sweep();
  idleSweeper = setInterval(sweep, 60_000);
}

export interface UpdatePartyInput {
  id: string;
  trackId: string | null;
  position: number;
  isPlaying: boolean;
}

export async function updateParty(input: UpdatePartyInput): Promise<boolean> {
  // Scope the write to still-active parties. If the party has already ended
  // (idle-swept, lazily reaped in getActiveParty, or manually ended) a PATCH
  // still in flight from the broadcaster must be a no-op, not a write to a
  // dead row. The broadcaster's own SSE/poll receiver already saw emit(null)
  // / a null poll and stopped its loop, so no client change is needed here.
  const { count } = await db.listeningParty.updateMany({
    where: { id: input.id, active: true },
    data: {
      trackId: input.trackId,
      position: input.position,
      isPlaying: input.isPlaying,
      pulse: { increment: 1 },
      // Only a *playing* update counts as activity; a paused heartbeat must
      // not refresh lastPlayingAt.
      ...(input.isPlaying ? { lastPlayingAt: new Date() } : {}),
    },
  });
  if (count === 0) return false;

  const updated = await db.listeningParty.findUnique({ where: { id: input.id } });
  if (updated) {
    const snap = await loadTrackSnapshot(updated.trackId);
    emit(toView(updated, snap));
  }
  return true;
}
