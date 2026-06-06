// Listening Party domain logic — kept out of the action layer so the
// API routes / actions / WhatsApp send all share one source of truth.

import { db } from "@/server/db";
import { env } from "@/lib/env";
import { sendWhatsApp } from "@/server/services/whatsapp-callmebot";

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
}

function toView(row: {
  id: string;
  active: boolean;
  startedBy: string;
  trackId: string | null;
  position: number;
  isPlaying: boolean;
  pulse: number;
  startedAt: Date;
  updatedAt: Date;
}): PartyView {
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
  };
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
  return row ? toView(row) : null;
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
  const created = await db.listeningParty.create({
    data: {
      active: true,
      startedBy: input.startedBy,
      trackId: input.trackId,
      position: input.position,
      isPlaying: input.isPlaying,
      pulse: 1,
    },
  });
  const view = toView(created);
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
  // Tell every SSE subscriber that the party is over so receivers can leave
  // follow mode immediately instead of waiting for their next poll.
  emit(null);
}

export interface UpdatePartyInput {
  id: string;
  trackId: string | null;
  position: number;
  isPlaying: boolean;
}

export async function updateParty(input: UpdatePartyInput): Promise<void> {
  const updated = await db.listeningParty.update({
    where: { id: input.id },
    data: {
      trackId: input.trackId,
      position: input.position,
      isPlaying: input.isPlaying,
      pulse: { increment: 1 },
    },
  });
  emit(toView(updated));
}
