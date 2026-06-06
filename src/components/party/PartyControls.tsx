"use client";

import { useEffect, useRef } from "react";
import { useIdentity } from "@/hooks/use-identity";
import { usePartyStore, type PartyView } from "@/stores/party-store";
import { usePlayerStore } from "@/stores/player-store";
import { getEngine } from "@/audio/engine";

// Tightened from 2000/1500 to 750/500 — most of the perceived "she's a few
// seconds ahead" gap came from these intervals. Combined with server-side
// ageMs and client-side round-trip compensation, the receiver now usually
// lands within ~150-300ms of the broadcaster.
const POLL_MS = 750;
const BROADCAST_MS = 500;
// Drift over this many seconds → re-seek. Lower = tighter sync but more
// audio stutter from frequent seeks. 0.4s is small enough that lip-sync
// content stays comfortable.
const POSITION_DRIFT_TOLERANCE = 0.4;

// Single component mounted at AppShell level. Handles:
//   • polling /api/party for the receiver to discover an active party
//   • broadcasting player state for the starter while a party is active
//   • mirroring the broadcaster's state into the local player when following
// The visual layer (start button, banner) reads from usePartyStore.
export function PartyControls() {
  const identity = useIdentity();
  const remote = usePartyStore((s) => s.remote);
  const following = usePartyStore((s) => s.following);
  const setRemote = usePartyStore((s) => s.setRemote);
  const setFollowing = usePartyStore((s) => s.setFollowing);

  // The compensated position from the latest poll. The follower effect
  // reads this rather than `remote.position` so it accounts for time that
  // elapsed between the broadcaster writing the state and the receiver
  // processing it.
  const latestSyncRef = useRef<{
    receivedAt: number;
    serverAgeMs: number;
    roundTripMs: number;
    position: number;
    isPlaying: boolean;
    trackId: string | null;
  } | null>(null);

  // ──────────────────────────── POLLER (both sides) ──────────────────────
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      const fetchStart = Date.now();
      try {
        const res = await fetch("/api/party", { cache: "no-store" });
        const roundTripMs = Date.now() - fetchStart;
        if (!stopped && res.ok) {
          const data = (await res.json()) as PartyView | null;
          setRemote(data);
          if (data?.active) {
            latestSyncRef.current = {
              receivedAt: Date.now(),
              serverAgeMs: data.ageMs,
              roundTripMs,
              position: data.position,
              isPlaying: data.isPlaying,
              trackId: data.trackId,
            };
          }
          if (!data?.active && following) setFollowing(false);
        }
      } catch {
        /* network blip */
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
    void tick();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [following, setRemote, setFollowing]);

  // ──────────────────────────── AUTO-JOIN (?party=…) ─────────────────────
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

  // ──────────────────────────── BROADCASTER (ainul) ──────────────────────
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

  // ──────────────────────────── FOLLOWER (fawwaz) ────────────────────────
  // Mirror remote state with time compensation: estimate the broadcaster's
  // CURRENT position by adding elapsed time since the broadcast was made.
  useEffect(() => {
    if (!following) return;
    const sync = latestSyncRef.current;
    if (!sync) return;

    // Total milliseconds between the broadcaster's clock when she wrote and
    // the receiver's clock right now. serverAgeMs is the gap from her write
    // to the server's response, roundTripMs/2 ≈ network leg back to here,
    // and (now - receivedAt) is how long we've been holding this snapshot.
    const elapsedSinceWrite =
      sync.serverAgeMs + sync.roundTripMs / 2 + (Date.now() - sync.receivedAt);
    const projectedPos =
      sync.isPlaying ? sync.position + elapsedSinceWrite / 1000 : sync.position;

    const localPlayer = usePlayerStore.getState();
    const currentLocalId = localPlayer.queue[localPlayer.currentIndex]?.id ?? null;
    if (sync.trackId && sync.trackId !== currentLocalId) {
      usePlayerStore.getState().setQueue(
        [
          {
            id: sync.trackId,
            title: "(synced)",
            duration: 0,
            artist: "",
            album: "",
            coverArtHash: null,
            ytVideoId: null,
          },
        ],
        0,
      );
    }
    if (localPlayer.isPlaying !== sync.isPlaying) {
      usePlayerStore.setState({ isPlaying: sync.isPlaying });
    }
    const engine = getEngine();
    if (Math.abs(engine.getCurrentTime() - projectedPos) > POSITION_DRIFT_TOLERANCE) {
      engine.seek(projectedPos);
      usePlayerStore.setState({ position: projectedPos });
    }
  }, [following, remote?.trackId, remote?.isPlaying, remote?.pulse]);

  return null;
}
