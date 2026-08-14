"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { useDownloadStore } from "@/stores/download-store";
import { usePartyStore } from "@/stores/party-store";
import { getEngine } from "@/audio/engine";
import { bindMediaSession, updateMediaMetadata } from "@/audio/media-session";
import { startPlay, updatePlayProgress } from "@/server/actions/playback";
import { Sidebar } from "./Sidebar";
import { RightPanel } from "./RightPanel";
import { PlayerBar } from "@/components/player/PlayerBar";
import { MiniPlayer } from "@/components/player/MiniPlayer";
import { NowPlayingSheet } from "@/components/player/NowPlayingSheet";
import { InstallHint } from "@/components/mobile/InstallHint";
import { MainContent } from "@/components/pages/MainContent";
import { VideoStage } from "@/components/player/VideoStage";
import { loadIframeAPI } from "@/components/player/YtVideoPanel";
import { DownloadIndicator } from "@/components/player/DownloadIndicator";
import { PartyControls } from "@/components/party/PartyControls";
import { OverlayPresence } from "@/components/overlay/OverlayPresence";
import { PartyBanner } from "@/components/party/PartyBanner";
import { KeyboardHelpDialog } from "@/components/player/KeyboardHelpDialog";
import { PatchNotesDialog } from "@/components/player/PatchNotesDialog";
import { readSeenVersion, unseenReleases } from "@/lib/patch-notes";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useIsMobile } from "@/hooks/use-media-query";
import { useIsHydrated } from "@/hooks/use-hydrated";
import { useDocumentVisible } from "@/hooks/use-document-visible";
import {
  updateMediaPositionState,
  setMediaPlaybackState,
} from "@/audio/media-session";
import { ChevronLeftIcon, MenuIcon, CloseIcon } from "@/components/icons";

export function AppShell() {
  const player = usePlayerStore();
  const pop = useIpodStore((s) => s.pop);
  const navStackLen = useIpodStore((s) => s.navStack.length);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const isMobile = useIsMobile();
  const documentVisible = useDocumentVisible();
  const setVideoGateEnabled = usePlayerStore((s) => s.setVideoGateEnabled);
  const mobileArtMode = usePlayerStore((s) => s.mobileArtMode);

  // Which layout is showing is decided in CSS (`md:hidden` / `hidden md:…`), so
  // there is no hydration flash. This flag only drives *behaviour* — what the
  // iframe does and whether audio may wait for it — where being briefly wrong
  // on the very first frame costs nothing.
  //
  // Audio must never wait for video on a phone: the iframe is torn down every
  // time the sheet closes or the screen locks, and a gate set just before a
  // teardown would leave her music silent with nothing left to start it.
  useEffect(() => {
    setVideoGateEnabled(!isMobile);
  }, [isMobile, setVideoGateEnabled]);

  // Derived, not synced: a sheet left open across a resize to desktop would
  // otherwise sit invisible (it is `md:hidden`) while still owning the video
  // slot. Deriving means there is no state to get out of step.
  const sheetVisible = sheetOpen && isMobile;

  // Effective art mode: performance mode always wins.
  const artMode = player.performanceMode || mobileArtMode;

  // The iframe exists only when someone can actually see it. On desktop that's
  // whenever performance mode is off; on a phone it additionally requires the
  // sheet open, art mode off, and the app on screen. Rebuilding costs ~500ms
  // when she reopens the sheet, which is the right trade against decoding
  // video in her pocket for a whole album.
  const currentHasVideo = !!player.queue[player.currentIndex]?.ytVideoId;
  const showVideoStage =
    !player.performanceMode &&
    (!isMobile ||
      (sheetVisible && !mobileArtMode && documentVisible && currentHasVideo));

  // Global keyboard shortcuts — space=play/pause, arrows for seek/track,
  // ?=help, /=search. Disabled while typing in inputs.
  const { helpOpen, closeHelp } = useKeyboardShortcuts();

  // Pre-warm the YT IFrame API script so the first YT track doesn't pay
  // its ~500ms script-load cost on top of the iframe-load cost.
  useEffect(() => {
    void loadIframeAPI();
  }, []);

  const historyIdRef = useRef<string | null>(null);
  const lastReportedSecondRef = useRef(0);
  const lastPositionSecondRef = useRef(-1);

  // Audio engine: load track when the selected playback attempt changes.
  // Deliberately does NOT depend on `player.queue` — pushing onto the queue
  // (addToQueue / playNext) creates a new array reference but doesn't change
  // which track is current, and we don't want that to yank el.src back to
  // the beginning of the currently-playing song.
  // Where playback was when the page was last closed. Captured on the very
  // first render — the store rehydrates from localStorage synchronously at
  // import time, and the audio element's first `timeupdate` fires with 0,
  // which would otherwise wipe the saved value before we could use it.
  // Consumed exactly once, so a later track change starts from the top.
  // What's new, shown once per release. Read from localStorage, so a fresh
  // browser or cleared storage sees it again — Settings has a permanent way in
  // for exactly that case.
  //
  // Gated on `hydrated` rather than `typeof window`: that check is already true
  // during the hydration render, so the client produced a dialog where the
  // server had sent none, and React threw away and rebuilt the entire tree on
  // every load with unread notes.
  const hydrated = useIsHydrated();
  const [notesDismissed, setNotesDismissed] = useState(false);
  const patchNotes = useMemo(
    () => (hydrated ? unseenReleases(readSeenVersion()) : []),
    [hydrated],
  );

  const resumeAtRef = useRef<number | null>(
    usePlayerStore.getState().position || null,
  );

  useEffect(() => {
    const engine = getEngine();
    const track = usePlayerStore.getState().queue[player.currentIndex];
    if (!track) return;
    engine.loadTrack(track.id);
    updateMediaMetadata(track);

    const resumeAt = resumeAtRef.current;
    resumeAtRef.current = null;
    if (resumeAt !== null && resumeAt > 0.5) {
      // Seek once the element actually has the media; seeking straight after
      // setting src is ignored because there is no duration yet.
      const off = engine.on("loaded", () => {
        engine.seek(resumeAt);
        usePlayerStore.setState({ position: resumeAt });
        off();
      });
      return off;
    }
  }, [player.currentIndex, player.playbackKey]);

  // Play/pause sync — soft gate. Includes playbackKey so that when the
  // current track changes (next/prev/setQueue) but isPlaying stays true
  // and videoLoading stays the same, this effect still re-runs and starts
  // the new track. Without playbackKey here, fawwaz silently failed to
  // hear ainul's next song because his setQueue with the same flags
  // never re-triggered engine.play().
  useEffect(() => {
    const engine = getEngine();
    if (player.isPlaying && !player.videoLoading) void engine.play();
    else engine.pause();
  }, [player.isPlaying, player.videoLoading, player.playbackKey]);

  // Volume sync
  useEffect(() => {
    getEngine().setVolume(player.volume);
  }, [player.volume]);

  // Keep the OS transport showing the right button. Without this the platform
  // infers state from the audio element, which drifts whenever playback is
  // gated in app code — the lock screen would offer Play while we consider
  // ourselves playing.
  useEffect(() => {
    setMediaPlaybackState(player.isPlaying);
  }, [player.isPlaying]);

  // Start a history row when a track starts playing
  useEffect(() => {
    const state = usePlayerStore.getState();
    const track = state.queue[state.currentIndex];
    if (!track || !state.isPlaying) return;
    let cancelled = false;
    void startPlay(track.id).then((id) => {
      if (cancelled) return;
      historyIdRef.current = id;
      lastReportedSecondRef.current = 0;
    });
    return () => {
      cancelled = true;
    };
  }, [player.currentIndex, player.isPlaying, player.playbackKey]);

  // Time tick → store + throttled history update. Single mount, reads
  // fresh state inside the callback so queue mutations don't have to
  // rebind the listener.
  useEffect(() => {
    const engine = getEngine();
    return engine.on("timeupdate", () => {
      const t = engine.getCurrentTime();
      usePlayerStore.getState().setPosition(t);
      const state = usePlayerStore.getState();
      const track = state.queue[state.currentIndex];
      // Feed the lock screen / Dynamic Island scrubber. Throttled to whole
      // seconds because timeupdate fires ~4x that and the arc can't show more.
      if (track) {
        const second = Math.floor(t);
        if (second !== lastPositionSecondRef.current) {
          lastPositionSecondRef.current = second;
          updateMediaPositionState(t, engine.getDuration() || track.duration);
        }
      }
      if (historyIdRef.current && track && track.duration > 0) {
        if (Math.floor(t) - lastReportedSecondRef.current >= 5) {
          const completed = t / track.duration >= 0.8;
          void updatePlayProgress(historyIdRef.current, t, completed);
          lastReportedSecondRef.current = Math.floor(t);
        }
      }
    });
  }, []);

  // Auto-advance on end. Three branches:
  //   1. Following a listening party — let the broadcaster's SSE drive the
  //      next track. Calling next() locally would briefly load a wrong track
  //      before the broadcaster's update arrives.
  //   2. repeat = "one" — seek back to 0 and replay the same track.
  //   3. anything else — sequential / shuffled advance via next().
  useEffect(() => {
    return getEngine().on("ended", () => {
      if (usePartyStore.getState().following) return;
      const player = usePlayerStore.getState();
      if (player.repeat === "one") {
        const engine = getEngine();
        engine.seek(0);
        void engine.play();
        usePlayerStore.setState({ position: 0 });
        return;
      }
      player.next();
    });
  }, []);

  // YT download polling — when a job is active in the download store, poll
  // /api/yt-status until the server marks it READY (or FAILED). On READY,
  // hand the pre-built queueTrack to the player so playback starts as soon
  // as the file is actually on disk. Survives navigation because this
  // effect lives on AppShell (always mounted), not on YtPickerPage.
  const activeDownload = useDownloadStore((s) => s.active);
  useEffect(() => {
    if (!activeDownload || activeDownload.error) return;
    const ytVideoId = activeDownload.id;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (stopped) return;
      try {
        const res = await fetch(`/api/yt-status/${ytVideoId}`, { cache: "no-store" });
        if (!stopped && res.ok) {
          const status = (await res.json()) as {
            status: "DOWNLOADING" | "READY" | "FAILED" | "UNKNOWN";
            errorMessage: string | null;
            progressPct: number | null;
          };
          if (stopped) return;
          if (status.status === "READY") {
            usePlayerStore.getState().setQueue([activeDownload!.queueTrack], 0);
            useDownloadStore.getState().finish();
            return;
          }
          if (status.status === "FAILED") {
            useDownloadStore
              .getState()
              .fail(status.errorMessage ?? "Download failed");
            return;
          }
          // DOWNLOADING — surface the live progress so the indicator stops
          // lying with its fake bar.
          useDownloadStore.getState().setProgress(status.progressPct);
        }
      } catch {
        /* network blip — try again */
      }
      timer = setTimeout(poll, 2500);
    }
    void poll();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [activeDownload]);

  // OS media session
  useEffect(() => {
    return bindMediaSession({
      onPlay: () => usePlayerStore.setState({ isPlaying: true }),
      onPause: () => usePlayerStore.setState({ isPlaying: false }),
      onPrev: () => usePlayerStore.getState().prev(),
      onNext: () => usePlayerStore.getState().next(),
      onSeekTo: (s) => {
        getEngine().seek(s);
        usePlayerStore.setState({ position: s });
      },
    });
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-zinc-800/50 bg-zinc-950 px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setSidebarOpen((s) => !s)}
          className="rounded p-2 text-zinc-300 hover:bg-zinc-800"
          aria-label="Menu"
        >
          {sidebarOpen ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
        </button>
        <h1 className="text-sm font-bold tracking-tight">
          Kyowave<span className="text-sky-500">.</span>
        </h1>
        {/* Balances the hamburger so the title stays centred. The old ♪ button
            lived here; lyrics and video are now a swipe up from the player. */}
        <span className="w-9" aria-hidden />
      </header>

      {/* Listening Party banner (fawwaz only, when a party is active) */}
      <PartyBanner />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar.
            On mobile it is a drawer, and tapping anything actionable inside it
            should dismiss it — otherwise she navigates to Songs and is still
            looking at the menu, with the list she asked for hidden behind it.
            Handled here rather than by threading a callback through Sidebar's
            five separate navigation call sites. */}
        <div
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button, a")) setSidebarOpen(false);
          }}
          className={
            "shrink-0 transition-transform md:block " +
            (sidebarOpen
              ? "fixed inset-y-0 left-0 z-30 translate-x-0"
              : "fixed inset-y-0 left-0 z-30 -translate-x-full md:relative md:translate-x-0")
          }
        >
          <Sidebar />
        </div>
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-20 bg-black/60 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {navStackLen > 1 && (
            <button
              type="button"
              onClick={pop}
              className="self-start rounded-full p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
              aria-label="Back"
            >
              <ChevronLeftIcon size={20} />
            </button>
          )}
          <div className="min-h-0 flex-1 overflow-hidden">
            <MainContent />
          </div>
        </main>

        {/* Right panel — desktop only. On a phone the now-playing sheet does
            this job, and a side drawer is the wrong shape for it besides. Not
            rendered at all rather than hidden, so its `data-video-slot="small"`
            can't compete with the sheet's for the iframe. */}
        <div className="hidden shrink-0 border-l border-zinc-800/50 md:relative md:block md:w-[340px]">
          <RightPanel />
        </div>
      </div>

      {/* Desktop transport. Below `md` it is replaced wholesale by the mini
          player + sheet; the swap is CSS so neither flashes on load. */}
      <div className="hidden md:block">
        <PlayerBar />
      </div>
      <div className="md:hidden">
        <MiniPlayer onOpen={() => setSheetOpen(true)} />
      </div>
      <NowPlayingSheet
        open={sheetVisible}
        onClose={() => setSheetOpen(false)}
        artMode={artMode}
      />

      {/* Single always-mounted YT iframe; positions itself over the active slot.
          Skipped entirely in Performance Mode — biggest GPU saving for the
          'use the app while gaming' case — and on mobile whenever nobody is
          looking at it. */}
      {showVideoStage && <VideoStage />}
      {/* Floating "downloading…" toast that persists across nav */}
      <DownloadIndicator />
      {/* Polls + broadcasts party state. Invisible — just side-effects. */}
      <PartyControls />
      <OverlayPresence />
      <InstallHint suppressed={!notesDismissed && patchNotes.length > 0} />
      <KeyboardHelpDialog open={helpOpen} onClose={closeHelp} />
      <PatchNotesDialog
        open={!notesDismissed && patchNotes.length > 0}
        releases={patchNotes}
        onClose={() => setNotesDismissed(true)}
      />
    </div>
  );
}
