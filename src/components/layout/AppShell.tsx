"use client";

import { useEffect, useRef, useState } from "react";
import { useIpodStore } from "@/stores/ipod-store";
import { usePlayerStore } from "@/stores/player-store";
import { useDownloadStore } from "@/stores/download-store";
import { getEngine } from "@/audio/engine";
import { bindMediaSession, updateMediaMetadata } from "@/audio/media-session";
import { startPlay, updatePlayProgress } from "@/server/actions/playback";
import { Sidebar } from "./Sidebar";
import { RightPanel } from "./RightPanel";
import { PlayerBar } from "@/components/player/PlayerBar";
import { MainContent } from "@/components/pages/MainContent";
import { VideoStage } from "@/components/player/VideoStage";
import { DownloadIndicator } from "@/components/player/DownloadIndicator";
import { KeyboardHelpDialog } from "@/components/player/KeyboardHelpDialog";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { ChevronLeftIcon, MenuIcon, CloseIcon } from "@/components/icons";

export function AppShell() {
  const player = usePlayerStore();
  const pop = useIpodStore((s) => s.pop);
  const navStackLen = useIpodStore((s) => s.navStack.length);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  // Global keyboard shortcuts — space=play/pause, arrows for seek/track,
  // ?=help, /=search. Disabled while typing in inputs.
  const { helpOpen, closeHelp } = useKeyboardShortcuts();

  const historyIdRef = useRef<string | null>(null);
  const lastReportedSecondRef = useRef(0);

  // Audio engine: load track when the selected playback attempt changes
  // (don't auto-play here — the videoLoading gate effect below handles that)
  useEffect(() => {
    const engine = getEngine();
    const track = player.queue[player.currentIndex];
    if (!track) return;
    engine.loadTrack(track.id);
    updateMediaMetadata(track);
  }, [player.currentIndex, player.playbackKey, player.queue]);

  // Play/pause sync — gated on videoLoading so audio waits for YT iframe
  // to load before starting. Once videoLoading flips false, audio starts.
  useEffect(() => {
    const engine = getEngine();
    if (player.isPlaying && !player.videoLoading) void engine.play();
    else engine.pause();
  }, [player.isPlaying, player.videoLoading]);

  // Volume sync
  useEffect(() => {
    getEngine().setVolume(player.volume);
  }, [player.volume]);

  // Start a history row when a track starts playing
  useEffect(() => {
    const track = player.queue[player.currentIndex];
    if (!track || !player.isPlaying) return;
    let cancelled = false;
    void startPlay(track.id).then((id) => {
      if (cancelled) return;
      historyIdRef.current = id;
      lastReportedSecondRef.current = 0;
    });
    return () => {
      cancelled = true;
    };
  }, [player.currentIndex, player.isPlaying, player.queue]);

  // Time tick → store + throttled history update
  useEffect(() => {
    const engine = getEngine();
    return engine.on("timeupdate", () => {
      const t = engine.getCurrentTime();
      usePlayerStore.getState().setPosition(t);
      const track = player.queue[player.currentIndex];
      if (historyIdRef.current && track && track.duration > 0) {
        if (Math.floor(t) - lastReportedSecondRef.current >= 5) {
          const completed = t / track.duration >= 0.8;
          void updatePlayProgress(historyIdRef.current, t, completed);
          lastReportedSecondRef.current = Math.floor(t);
        }
      }
    });
  }, [player.currentIndex, player.queue]);

  // Auto-advance on end
  useEffect(() => {
    return getEngine().on("ended", () => {
      usePlayerStore.getState().next();
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
          Music<span className="text-emerald-500">.</span>
        </h1>
        <button
          type="button"
          onClick={() => setRightOpen((s) => !s)}
          className="rounded p-2 text-zinc-300 hover:bg-zinc-800"
          aria-label="Lyrics / Video"
        >
          ♪
        </button>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
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

        {/* Right panel */}
        <div
          className={
            "shrink-0 border-l border-zinc-800/50 transition-transform md:block " +
            (rightOpen
              ? "fixed inset-y-0 right-0 z-30 w-80 translate-x-0"
              : "fixed inset-y-0 right-0 z-30 w-80 translate-x-full md:relative md:w-[340px] md:translate-x-0")
          }
        >
          <RightPanel />
        </div>
        {rightOpen && (
          <button
            type="button"
            aria-label="Close panel"
            className="fixed inset-0 z-20 bg-black/60 md:hidden"
            onClick={() => setRightOpen(false)}
          />
        )}
      </div>

      <PlayerBar />
      {/* Single always-mounted YT iframe; positions itself over the active slot */}
      <VideoStage />
      {/* Floating "downloading…" toast that persists across nav */}
      <DownloadIndicator />
      <KeyboardHelpDialog open={helpOpen} onClose={closeHelp} />
    </div>
  );
}
