"use client";

import { useEffect, useRef } from "react";
import { useIdentity } from "@/hooks/use-identity";
import { usePartyStore, type PartyView } from "@/stores/party-store";
import { usePlayerStore } from "@/stores/player-store";
import { getEngine } from "@/audio/engine";

// Broadcaster (ainul) still posts state via PATCH on every meaningful
// player change. With SSE in place we can lean the broadcast interval down
// hard — receivers see updates the instant the server processes the PATCH.
const BROADCAST_MS = 500;

// Drift over this many seconds → re-seek. Tighter than the previous polling
// implementation because SSE delivers updates near-instantly, so when we
// notice drift it's usually real (not stale data).
const POSITION_DRIFT_TOLERANCE = 0.3;

interface ReceiverSync {
  /** Wall-clock when we received this snapshot. */
  receivedAt: number;
  /** Server's reported ms since the broadcaster wrote this state. */
  serverAgeMs: number;
  position: number;
  isPlaying: boolean;
  trackId: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
  trackCoverArtHash: string | null;
  trackYtVideoId: string | null;
}

export function PartyControls() {
  const identity = useIdentity();
  const remote = usePartyStore((s) => s.remote);
  const following = usePartyStore((s) => s.following);
  const setRemote = usePartyStore((s) => s.setRemote);
  const setFollowing = usePartyStore((s) => s.setFollowing);

  const latestSyncRef = useRef<ReceiverSync | null>(null);

  // ─── Receiver transport (both sides) ───────────────────────────────────
  // Tries SSE first (push, sub-100ms). If SSE doesn't open within 3s — old
  // browser without EventSource, corporate proxy that strips streams,
  // origin behind a buffering reverse proxy — silently degrades to polling
  // at the same 750ms cadence we had pre-SSE so the party still works,
  // just with the old desync floor.
  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let openWatchdog: ReturnType<typeof setTimeout> | null = null;
    let mode: "sse" | "poll" | "closed" = "sse";
    let receivedFirstMessage = false;

    function applyState(data: PartyView | null, roundTripMs = 0) {
      setRemote(data);
      if (data?.active) {
        latestSyncRef.current = {
          receivedAt: Date.now(),
          serverAgeMs: data.ageMs + roundTripMs / 2, // small RTT correction for poll path
          position: data.position,
          isPlaying: data.isPlaying,
          trackId: data.trackId,
          trackTitle: data.trackTitle,
          trackArtist: data.trackArtist,
          trackCoverArtHash: data.trackCoverArtHash,
          trackYtVideoId: data.trackYtVideoId,
        };
      } else if (following) {
        setFollowing(false);
      }
    }

    async function pollOnce() {
      const t0 = Date.now();
      try {
        const res = await fetch("/api/party", { cache: "no-store" });
        if (mode !== "poll") return;
        if (res.ok) {
          const data = (await res.json()) as PartyView | null;
          applyState(data, Date.now() - t0);
        }
      } catch {
        /* network blip */
      }
      if (mode === "poll") pollTimer = setTimeout(pollOnce, 750);
    }

    function switchToPolling() {
      if (mode !== "sse") return;
      console.warn("[mu] party: SSE didn't open within 3s — falling back to polling");
      mode = "poll";
      es?.close();
      es = null;
      void pollOnce();
    }

    function trySSE() {
      if (typeof EventSource === "undefined") {
        switchToPolling();
        return;
      }
      es = new EventSource("/api/party/stream");
      es.onopen = () => {
        // Connection alive — clear the watchdog so we don't bounce to
        // polling if a later transient error fires.
        if (openWatchdog !== null) {
          clearTimeout(openWatchdog);
          openWatchdog = null;
        }
      };
      es.onmessage = (e) => {
        receivedFirstMessage = true;
        if (openWatchdog !== null) {
          clearTimeout(openWatchdog);
          openWatchdog = null;
        }
        let data: PartyView | null = null;
        try {
          data = JSON.parse(e.data) as PartyView | null;
        } catch {
          return;
        }
        // SSE delivery is a single TCP write; treat ageMs as-is (no
        // round-trip term).
        applyState(data, 0);
      };
      es.onerror = () => {
        // EventSource auto-reconnects with a backoff after a healthy open,
        // so if we've already received a message we let it ride. Only the
        // never-opened path triggers polling fallback (handled by the
        // watchdog below).
      };

      openWatchdog = setTimeout(() => {
        if (!receivedFirstMessage && es?.readyState !== EventSource.OPEN) {
          switchToPolling();
        }
      }, 3000);
    }

    trySSE();

    return () => {
      mode = "closed";
      es?.close();
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (openWatchdog !== null) clearTimeout(openWatchdog);
    };
  }, [following, setRemote, setFollowing]);

  // ─── AUTO-JOIN (?party=…) ──────────────────────────────────────────────
  useEffect(() => {
    if (identity !== "fawwaz") return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const partyId = url.searchParams.get("party");
    if (!partyId) return;
    setFollowing(true);
    url.searchParams.delete("party");
    window.history.replaceState(null, "", url.toString());
  }, [identity, setFollowing]);

  // ─── Follower roster ping ──────────────────────────────────────────────
  // Tell the server when our identity enters / leaves follow mode so the
  // broadcaster's banner can show who's actually listening. Best-effort —
  // failure here just means the roster is slightly stale until next change.
  useEffect(() => {
    if (!identity) return;
    if (following) {
      void fetch("/api/party/follow", { method: "POST" }).catch(() => {});
      // Leave on unmount or following=false transition.
      return () => {
        void fetch("/api/party/follow", { method: "DELETE" }).catch(() => {});
      };
    }
  }, [identity, following]);

  // ─── BROADCASTER (ainul) ───────────────────────────────────────────────
  const isBroadcasting = identity === "ainul" && !!remote?.active;
  const playerCurrent = usePlayerStore((s) => s.queue[s.currentIndex] ?? null);
  const playerIsPlaying = usePlayerStore((s) => s.isPlaying);
  const playerKey = usePlayerStore((s) => s.playbackKey);

  useEffect(() => {
    if (!isBroadcasting || !remote) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const partyId = remote.id;

    async function send() {
      const engine = getEngine();
      const pos = engine.getCurrentTime();
      const isPlayingNow = usePlayerStore.getState().isPlaying;
      const trackId =
        usePlayerStore.getState().queue[usePlayerStore.getState().currentIndex]?.id ?? null;
      try {
        await fetch("/api/party", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: partyId, trackId, position: pos, isPlaying: isPlayingNow }),
        });
      } catch {
        /* drop */
      }
    }
    void send();
    function loop() {
      timer = setTimeout(async () => {
        if (stopped) return;
        await send();
        loop();
      }, BROADCAST_MS);
    }
    loop();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [isBroadcasting, remote?.id, playerCurrent?.id, playerIsPlaying, playerKey]);

  // ─── FOLLOWER (fawwaz) ─────────────────────────────────────────────────
  // Project the broadcaster's CURRENT position by adding the time elapsed
  // since the server stamped the broadcast. No round-trip term needed —
  // SSE delivery is essentially a single TCP write, sub-100ms on a
  // healthy network.
  useEffect(() => {
    if (!following) return;
    const sync = latestSyncRef.current;
    if (!sync) return;

    const elapsedSinceWrite = sync.serverAgeMs + (Date.now() - sync.receivedAt);
    const projectedPos =
      sync.isPlaying ? sync.position + elapsedSinceWrite / 1000 : sync.position;

    const localPlayer = usePlayerStore.getState();
    const currentLocalId = localPlayer.queue[localPlayer.currentIndex]?.id ?? null;
    if (sync.trackId && sync.trackId !== currentLocalId) {
      // Enriched placeholder — uses the broadcaster's actual track
      // metadata so PlayerBar / lyrics panel / video tile show the real
      // song info instead of '(synced)'.
      usePlayerStore.getState().setQueue(
        [
          {
            id: sync.trackId,
            title: sync.trackTitle ?? "Now playing",
            duration: 0,
            artist: sync.trackArtist ?? "",
            album: "",
            coverArtHash: sync.trackCoverArtHash,
            ytVideoId: sync.trackYtVideoId,
          },
        ],
        0,
      );
    }
    if (localPlayer.isPlaying !== sync.isPlaying) {
      usePlayerStore.setState({ isPlaying: sync.isPlaying });
    }
    const engine = getEngine();
    // Don't seek if the audio element isn't in a state to handle it cleanly
    // (mid-seek, mid-buffer). The next pulse will check again. Without this
    // guard a slow network → buffering audio → re-seek → more buffering loop
    // is easy to fall into: each pulse triggers a fresh seek before the
    // previous one settles, and audio appears to 'loop' a small region.
    if (!engine.isStableForSeek()) return;
    if (Math.abs(engine.getCurrentTime() - projectedPos) > POSITION_DRIFT_TOLERANCE) {
      engine.seek(projectedPos);
      usePlayerStore.setState({ position: projectedPos });
    }
  }, [following, remote?.trackId, remote?.isPlaying, remote?.pulse]);

  return null;
}
