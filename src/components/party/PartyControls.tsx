"use client";

import { useEffect, useRef, useState } from "react";
import { useIdentity } from "@/hooks/use-identity";
import { usePartyStore, type PartyView } from "@/stores/party-store";
import { usePlayerStore } from "@/stores/player-store";
import { getEngine } from "@/audio/engine";

const POLL_MS = 2000;
const BROADCAST_MS = 1500;
const POSITION_DRIFT_TOLERANCE = 1.0; // seconds

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

  // ──────────────────────────── POLLER (both sides) ──────────────────────
  // Both sides poll. fawwaz polls to discover ainul's party. ainul polls
  // mostly to keep her local 'remote' state fresh (e.g. if she ended the
  // party from another tab).
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const res = await fetch("/api/party", { cache: "no-store" });
        if (!stopped && res.ok) {
          const data = (await res.json()) as PartyView | null;
          setRemote(data);
          // If we're 'following' but the server says no active party, exit.
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
  // When fawwaz lands on the app via the WhatsApp link, we auto-enter
  // following mode. Strips the query param afterwards so a refresh doesn't
  // re-trigger this if he's already left.
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
  // While ainul has an active party, push state every BROADCAST_MS or on
  // any meaningful player change. Keeps the followers within ~1.5s.
  const isBroadcasting = identity === "ainul" && !!remote?.active;
  const playerCurrent = usePlayerStore((s) => s.queue[s.currentIndex] ?? null);
  const playerIsPlaying = usePlayerStore((s) => s.isPlaying);
  const playerKey = usePlayerStore((s) => s.playbackKey);
  const lastBroadcastRef = useRef<{ pos: number; ts: number }>({ pos: 0, ts: 0 });

  useEffect(() => {
    if (!isBroadcasting || !remote) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const partyId = remote.id;

    async function send() {
      const engine = getEngine();
      const pos = engine.getCurrentTime();
      const isPlayingNow = usePlayerStore.getState().isPlaying;
      const trackId = usePlayerStore.getState().queue[usePlayerStore.getState().currentIndex]?.id ?? null;
      lastBroadcastRef.current = { pos, ts: Date.now() };
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
  // Mirror remote.trackId / position / isPlaying onto our local player.
  // Setting the queue with a placeholder QueueTrack (just an id with
  // unknown title/duration) lets the audio engine load and play; the
  // PartyBanner shows the real title from `remote`.
  useEffect(() => {
    if (!following || !remote) return;
    const localPlayer = usePlayerStore.getState();
    const currentLocalId = localPlayer.queue[localPlayer.currentIndex]?.id ?? null;
    if (remote.trackId && remote.trackId !== currentLocalId) {
      // New track on her side — set ours.
      usePlayerStore.getState().setQueue(
        [
          {
            id: remote.trackId,
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
    // Sync isPlaying.
    if (localPlayer.isPlaying !== remote.isPlaying) {
      usePlayerStore.setState({ isPlaying: remote.isPlaying });
    }
    // Sync position if drifted.
    const engine = getEngine();
    if (Math.abs(engine.getCurrentTime() - remote.position) > POSITION_DRIFT_TOLERANCE) {
      engine.seek(remote.position);
      usePlayerStore.setState({ position: remote.position });
    }
  }, [following, remote?.trackId, remote?.isPlaying, remote?.position, remote?.pulse]);

  return null;
}
