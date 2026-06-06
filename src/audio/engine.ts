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
}

const MAX_RETRIES = 8;
const BASE_RETRY_MS = 400;
const MAX_RETRY_MS = 3000;

export function createEngine(): AudioEngine {
  const el =
    typeof document !== "undefined" ? document.createElement("audio") : ({} as HTMLAudioElement);
  // "auto" means the browser starts buffering audio data immediately on
  // src assignment, not just metadata. By the time play() is called the
  // first chunks are usually already in memory — kills most of the
  // 'click → silence → start' lag. Costs a bit more bandwidth on tracks
  // the user previews and skips, fine for personal use.
  el.preload = "auto";
  let rawSrc = "";
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let currentLoadId = 0;

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
    // MediaError codes: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
    // We see 4 when /api/audio returned 425 (track row exists but filePath
    // not populated yet — usually because the YT download just landed and
    // DB consistency lags by a beat) or non-200.
    if (retryCount >= MAX_RETRIES) {
      console.warn(`[mu] audio: gave up after ${MAX_RETRIES} retries on ${rawSrc}`);
      return;
    }
    const delay = Math.min(BASE_RETRY_MS * Math.pow(1.5, retryCount), MAX_RETRY_MS);
    retryCount++;
    console.log(`[mu] audio: retry ${retryCount}/${MAX_RETRIES} in ${delay}ms (${rawSrc})`);
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
  }

  if (typeof document !== "undefined") {
    el.addEventListener("error", onMediaError);
    el.addEventListener("loadeddata", onLoadedData);
  }

  return {
    loadTrack: (trackId) => {
      currentLoadId++;
      clearRetry();
      retryCount = 0;
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
      // "loaded" maps to loadeddata for legacy callers
      const eventName = event === "loaded" ? "loadeddata" : event;
      el.addEventListener(eventName, handler);
      return () => el.removeEventListener(eventName, handler);
    },
    destroy: () => {
      clearRetry();
      el.pause();
      el.removeAttribute("src");
    },
  };
}

let singleton: AudioEngine | null = null;

export function getEngine(): AudioEngine {
  if (!singleton) singleton = createEngine();
  return singleton;
}
