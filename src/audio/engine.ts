export interface AudioEngine {
  loadTrack: (trackId: string) => void;
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  getSrc: () => string;
  getCurrentTime: () => number;
  getVolume: () => number;
  getDuration: () => number;
  on: (event: "timeupdate" | "ended" | "play" | "pause" | "error" | "loaded", handler: () => void) => () => void;
  destroy: () => void;
  /** True when the element is currently performing a seek operation OR
      doesn't have enough buffered data to play smoothly. Listening-party
      follower uses this to skip its position-correction seek if the audio
      isn't in a state to honor it cleanly — otherwise it'd just queue up
      another seek on top of the in-flight one and never converge. */
  isStableForSeek: () => boolean;
}

const MAX_RETRIES = 8;
const BASE_RETRY_MS = 400;
const MAX_RETRY_MS = 3000;

// When timeupdate reports a backwards jump bigger than this many seconds we
// log it. Lets the user paste a clean log line when they see the
// '0:57 → 0:59 → 0:57' loop behavior so we can correlate with the underlying
// buffer event.
const BACKWARDS_JUMP_THRESHOLD = 0.5;

export function createEngine(): AudioEngine {
  const el =
    typeof document !== "undefined" ? document.createElement("audio") : ({} as HTMLAudioElement);
  el.preload = "auto";
  let rawSrc = "";
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let currentLoadId = 0;
  // Position to restore on the NEXT loadeddata — used by the retry path so a
  // transient mid-track error doesn't yank playback back to t=0.
  let pendingResumeAt = 0;
  let lastReportedTime = 0;

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function tryLoad(src: string, myLoadId: number) {
    if (myLoadId !== currentLoadId) return; // a newer track took over
    el.src = src;
  }

  function onMediaError() {
    if (!rawSrc) return;
    if (retryCount >= MAX_RETRIES) {
      console.warn(`[mu] audio: gave up after ${MAX_RETRIES} retries on ${rawSrc}`);
      return;
    }
    // Save the playhead so the retry can resume mid-track instead of resetting
    // to 0. Particularly important when the error fires mid-playback (e.g.
    // transient network blip, Cloudflare hiccup) rather than on initial load.
    pendingResumeAt = el.currentTime || 0;
    const delay = Math.min(BASE_RETRY_MS * Math.pow(1.5, retryCount), MAX_RETRY_MS);
    retryCount++;
    console.log(
      `[mu] audio: retry ${retryCount}/${MAX_RETRIES} in ${delay}ms (${rawSrc}) — resume at ${pendingResumeAt.toFixed(2)}s`,
    );
    const myLoadId = currentLoadId;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      tryLoad(rawSrc, myLoadId);
    }, delay);
  }

  function onLoadedData() {
    if (retryCount > 0) {
      console.log(`[mu] audio: loaded after ${retryCount} retries (${rawSrc})`);
    }
    retryCount = 0;
    // If we saved a pre-retry position, jump back to it now that we have data.
    // Only honor positive resume times — the "fresh loadTrack" path explicitly
    // sets this to 0 and we don't want to seek to 0 explicitly.
    if (pendingResumeAt > 0.05) {
      try {
        el.currentTime = pendingResumeAt;
        console.log(`[mu] audio: resumed at ${pendingResumeAt.toFixed(2)}s after retry`);
      } catch {
        /* ignore — element might not be seekable yet */
      }
    }
    pendingResumeAt = 0;
  }

  // ─── Diagnostic listeners ─────────────────────────────────────────────
  // Browser buffer events — fire when the network can't keep up with audio
  // playback. Helps pinpoint the '0:57 looping' bug as a buffer-underrun
  // problem rather than a code bug. Logs are dev-only by being scoped to the
  // browser console; no remote shipping.
  function logEvent(name: string) {
    console.log(`[mu] audio.${name} @ ${el.currentTime.toFixed(2)}s readyState=${el.readyState} buffered=${describeBuffered()}`);
  }
  function describeBuffered() {
    try {
      const r = el.buffered;
      if (r.length === 0) return "[]";
      const parts: string[] = [];
      for (let i = 0; i < r.length; i++) {
        parts.push(`${r.start(i).toFixed(1)}-${r.end(i).toFixed(1)}`);
      }
      return `[${parts.join(",")}]`;
    } catch {
      return "n/a";
    }
  }
  function onTimeUpdateDiag() {
    const t = el.currentTime;
    if (lastReportedTime > 0 && lastReportedTime - t > BACKWARDS_JUMP_THRESHOLD) {
      console.warn(
        `[mu] audio: BACKWARDS jump ${lastReportedTime.toFixed(2)}s → ${t.toFixed(2)}s readyState=${el.readyState} buffered=${describeBuffered()}`,
      );
    }
    lastReportedTime = t;
  }

  if (typeof document !== "undefined") {
    el.addEventListener("error", onMediaError);
    el.addEventListener("loadeddata", onLoadedData);
    el.addEventListener("waiting", () => logEvent("waiting"));
    el.addEventListener("stalled", () => logEvent("stalled"));
    el.addEventListener("suspend", () => logEvent("suspend"));
    el.addEventListener("seeking", () => logEvent("seeking"));
    el.addEventListener("seeked", () => logEvent("seeked"));
    el.addEventListener("timeupdate", onTimeUpdateDiag);
  }

  return {
    loadTrack: (trackId) => {
      currentLoadId++;
      clearRetry();
      retryCount = 0;
      pendingResumeAt = 0;
      lastReportedTime = 0;
      rawSrc = `/api/audio/${trackId}`;
      el.src = rawSrc;
    },
    play: async () => {
      try {
        await el.play();
      } catch {
        /* autoplay blocked or no src */
      }
    },
    pause: () => el.pause(),
    seek: (seconds) => {
      el.currentTime = seconds;
    },
    setVolume: (v) => {
      el.volume = Math.max(0, Math.min(1, v));
    },
    getSrc: () => rawSrc,
    getCurrentTime: () => el.currentTime || 0,
    getVolume: () => el.volume,
    getDuration: () => el.duration || 0,
    on: (event, handler) => {
      const eventName = event === "loaded" ? "loadeddata" : event;
      el.addEventListener(eventName, handler);
      return () => el.removeEventListener(eventName, handler);
    },
    destroy: () => {
      clearRetry();
      el.pause();
      el.removeAttribute("src");
    },
    isStableForSeek: () => {
      // HAVE_FUTURE_DATA (3) or HAVE_ENOUGH_DATA (4) means the element has
      // enough buffered to advance smoothly. !el.seeking means no other
      // seek is in flight that ours would clobber.
      return !el.seeking && el.readyState >= 3;
    },
  };
}

let singleton: AudioEngine | null = null;

export function getEngine(): AudioEngine {
  if (!singleton) singleton = createEngine();
  return singleton;
}
