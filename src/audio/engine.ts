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
  on: (event: "timeupdate" | "ended" | "play" | "pause", handler: () => void) => () => void;
  destroy: () => void;
}

export function createEngine(): AudioEngine {
  const el = typeof document !== "undefined" ? document.createElement("audio") : ({} as HTMLAudioElement);
  el.preload = "metadata";
  let rawSrc = "";

  return {
    loadTrack: (trackId) => {
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
      el.addEventListener(event, handler);
      return () => el.removeEventListener(event, handler);
    },
    destroy: () => {
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
