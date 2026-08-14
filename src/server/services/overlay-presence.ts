// In-memory "what's playing right now" presence for the public OBS overlay.
// The logged-in Kyowave tab POSTs here (via /api/presence); the public overlay
// reads it (via /api/overlay/now-playing). Lives in this single Node worker —
// same assumption as party-service. Cleared on restart; repopulates within
// one heartbeat of the player tab.
export interface Presence {
  name: string;
  title: string | null;
  artist: string | null;
  coverArtHash: string | null;
  ytVideoId: string | null;
  position: number;
  duration: number;
  isPlaying: boolean;
  updatedAt: number;
}

// Hide the overlay if no heartbeat within this window (tab closed / navigated).
const STALE_MS = 15_000;

const store = new Map<string, Presence>();

export function setPresence(name: string, d: Omit<Presence, "name" | "updatedAt">): void {
  store.set(name, { name, ...d, updatedAt: Date.now() });
}

// who = specific listener name (e.g. "ainul"); omit to get the most recently
// active listener. Returns null when nothing fresh.
export function getPresence(who?: string | null): Presence | null {
  const now = Date.now();
  if (who) {
    const p = store.get(who);
    return p && now - p.updatedAt < STALE_MS ? p : null;
  }
  let best: Presence | null = null;
  for (const p of store.values()) {
    if (now - p.updatedAt >= STALE_MS) continue;
    if (!best || p.updatedAt > best.updatedAt) best = p;
  }
  return best;
}
