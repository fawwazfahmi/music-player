"use client";

import { useEffect, useRef } from "react";

// Kyote -> OBS now-playing overlay. Transparent browser source that mirrors
// whatever the Kyowave player tab is playing (via /api/overlay/now-playing).
// Same look as the standalone OBS widget: album-art colour gradient, animated
// eq bars, progress bar.
//
// OBS Browser source URL:  https://<domain>/overlay/now-playing
//   ?key=<OVERLAY_TOKEN>   if you set the secret in .env
//   ?who=ainul             pin to a specific listener (else: most recent)
//   ?div=20                width scale (smaller = bigger card)
//   ?radius=20px  ?accent=1db954
// Set the source WIDTH to taste; height auto ~ width * 0.31 (e.g. 640x200).

interface NP {
  found: boolean;
  playing?: boolean;
  title?: string | null;
  artist?: string | null;
  coverArtHash?: string | null;
  ytVideoId?: string | null;
  position?: number;
  duration?: number;
  ageMs?: number;
  /** Server generation; changes on deploy. See the reload check in poll(). */
  gen?: string;
}

const STYLE = `
#np { --art-a:rgba(58,28,113,.32); --art-b:rgba(215,109,119,.32); --art-c:rgba(255,175,123,.32); --glass:rgba(10,14,22,.55); --accent:#1db954; --radius:20px; --pad:1.15rem; }
html { background:transparent !important; }
body { background:transparent !important; margin:0; overflow:hidden; font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",sans-serif; color:#fff; }
#np { position:absolute; inset:0; }
#np .card { position:absolute; left:1.5rem; top:1rem; width:calc(100% - 3rem); padding:var(--pad); display:flex; gap:.83rem; align-items:center; border-radius:var(--radius); background:linear-gradient(180deg,rgba(255,255,255,.15),rgba(255,255,255,.04)),linear-gradient(135deg,var(--art-a),var(--art-b) 55%,var(--art-c)),var(--glass); backdrop-filter:blur(16px) saturate(120%); box-shadow:0 .5rem 1.2rem rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.14); overflow:hidden; transition:opacity .5s ease, transform .5s ease, background .6s ease; }
#np .card::after { content:""; position:absolute; inset:0; pointer-events:none; background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,0) 40%); }
#np .card.hidden { opacity:0; transform:translateY(.8rem); }
#np .art { width:4.5rem; height:4.5rem; flex-shrink:0; border-radius:max(6px, calc(var(--radius) - var(--pad))); box-shadow:0 .33rem 1rem rgba(0,0,0,.45); background:#222 center/cover no-repeat; }
#np .info { flex:1; min-width:0; z-index:1; }
#np .titlerow { display:flex; align-items:center; gap:.42rem; min-width:0; }
#np .eq { display:inline-flex; align-items:flex-end; gap:.08rem; height:.83rem; flex-shrink:0; }
#np .eq span { width:.125rem; background:var(--accent); border-radius:.08rem; box-shadow:0 0 .25rem rgba(29,185,84,.7); animation:npbounce 1s ease-in-out infinite; }
#np .eq span:nth-child(1){animation-delay:-.9s} #np .eq span:nth-child(2){animation-delay:-.6s} #np .eq span:nth-child(3){animation-delay:-.3s} #np .eq span:nth-child(4){animation-delay:-.75s}
@keyframes npbounce { 0%,100%{height:.2rem} 50%{height:.83rem} }
#np .card.paused .eq span { animation-play-state:paused; height:.25rem; opacity:.6; }
#np .title { font-size:1rem; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 1px 8px rgba(0,0,0,.35); }
#np .artist { font-size:.667rem; font-weight:500; color:rgba(255,255,255,.82); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:.08rem; }
#np .bar { margin-top:.58rem; height:.25rem; border-radius:.17rem; background:rgba(255,255,255,.22); overflow:hidden; }
#np .bar .fill { height:100%; width:0%; border-radius:.17rem; background:#fff; }
#np .times { display:flex; justify-content:space-between; margin-top:.3rem; font-size:.5rem; font-weight:600; color:rgba(255,255,255,.8); font-variant-numeric:tabular-nums; }
`;

export default function OverlayNowPlaying() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const p = new URLSearchParams(window.location.search);
    const div = parseFloat(p.get("div") || "20") || 20;
    const key = p.get("key");
    const who = p.get("who");
    const radius = p.get("radius");
    const accent = p.get("accent");
    // Translucency of the album-colour tint. Matches the KyoTips overlays'
    // glass look (~.32 over an rgba(10,14,22,.55) base) so the scene reads
    // through the card. 1 = the old fully opaque look.
    const num = (raw: string | null, dflt: number) => {
      const v = parseFloat(raw ?? "");
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : dflt;
    };
    // Two knobs, because they do different jobs. `alpha` tints the card with the
    // album's colours; `glass` is the dark base underneath. The base dominates,
    // so lowering `glass` is what actually makes the scene show through —
    // dropping `alpha` alone just desaturates a still-solid card.
    const alpha = num(p.get("alpha"), 0.32);
    const glass = num(p.get("glass"), 0.55);
    root.style.setProperty("--glass", `rgba(10,14,22,${glass})`);
    document.documentElement.style.fontSize = `calc(100vw / ${div})`;
    if (radius) root.style.setProperty("--radius", radius);
    if (accent) root.style.setProperty("--accent", accent.startsWith("#") ? accent : `#${accent}`);

    const params = new URLSearchParams();
    if (key) params.set("key", key);
    if (who) params.set("who", who);
    const qs = params.toString();
    const endpoint = "/api/overlay/now-playing" + (qs ? `?${qs}` : "");

    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    const card = q<HTMLDivElement>(".card");
    const artEl = q<HTMLDivElement>(".art");
    const titleEl = q<HTMLElement>(".title");
    const artistEl = q<HTMLElement>(".artist");
    const elapsedEl = q<HTMLElement>(".elapsed");
    const totalEl = q<HTMLElement>(".total");
    const fillEl = q<HTMLDivElement>(".fill");

    let track = { id: "", playing: false, duration: 0, pos: 0, at: 0, found: false };
    let gen = "";
    const fmt = (s: number) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
    const artUrl = (hash?: string | null, yt?: string | null) =>
      hash ? `/api/art/${hash}` : yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null;

    const setGradient = (a: string, b: string, c: string) => {
      root.style.setProperty("--art-a", a); root.style.setProperty("--art-b", b); root.style.setProperty("--art-c", c);
    };
    const resetArt = () => {
      artEl.style.backgroundImage = "none";
      setGradient(`rgba(58,28,113,${alpha})`, `rgba(215,109,119,${alpha})`, `rgba(255,175,123,${alpha})`);
    };
    const dist = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    const darken = (c: { r: number; g: number; b: number }, f: number) => ({ r: Math.round(c.r * f), g: Math.round(c.g * f), b: Math.round(c.b * f) });
    const rgb = (c: { r: number; g: number; b: number }) => `rgba(${c.r},${c.g},${c.b},${alpha})`;
    // Always three colours or nothing — the tuple says so, which is what lets
    // the caller index it without assertions.
    function extractColors(img: HTMLImageElement): [string, string, string] | null {
      const n = 40; const cv = document.createElement("canvas"); cv.width = n; cv.height = n;
      const ctx = cv.getContext("2d", { willReadFrequently: true }); if (!ctx) return null;
      ctx.drawImage(img, 0, 0, n, n);
      let data: Uint8ClampedArray;
      try { data = ctx.getImageData(0, 0, n, n).data; } catch { return null; }
      const buckets: Record<string, { r: number; g: number; b: number; w: number }> = {};
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!; if (a < 128) continue;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const sat = mx === 0 ? 0 : (mx - mn) / mx; const val = mx / 255;
        const kk = (r >> 5) + "," + (g >> 5) + "," + (b >> 5); const w = sat * val + 0.05;
        const bk = buckets[kk] || (buckets[kk] = { r: 0, g: 0, b: 0, w: 0 }); bk.r += r * w; bk.g += g * w; bk.b += b * w; bk.w += w;
      }
      const arr = Object.values(buckets).map((bk) => ({ r: Math.round(bk.r / bk.w), g: Math.round(bk.g / bk.w), b: Math.round(bk.b / bk.w), score: bk.w })).sort((x, y) => y.score - x.score);
      if (!arr.length) return null;
      const first = arr[0]!; const second = arr.find((c) => dist(c, first) > 55) ?? arr[1] ?? first;
      const third = arr.find((c) => dist(c, first) > 55 && dist(c, second) > 45) ?? second;
      return [rgb(darken(first, 0.85)), rgb(darken(second, 0.8)), rgb(darken(third, 0.75))];
    }
    function loadArt(url: string | null) {
      if (!url) { resetArt(); return; }
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { artEl.style.backgroundImage = `url("${url}")`; const c = extractColors(img); if (c) setGradient(c[0], c[1], c[2]); };
      img.onerror = resetArt; img.src = url;
    }

    async function poll() {
      try {
        const j: NP = await (await fetch(endpoint, { cache: "no-store" })).json();
        // A deploy happened: pick up the new page instead of rendering stale
        // markup until someone can refresh the OBS source by hand.
        if (j.gen) {
          if (!gen) gen = j.gen;
          else if (gen !== j.gen) { window.location.reload(); return; }
        }
        if (!j.found) { track.found = false; card.classList.add("hidden"); return; }
        const id = (j.title || "") + "|" + (j.artist || "");
        const changed = id !== track.id;
        track = { id, playing: !!j.playing, duration: j.duration || 0, pos: j.position || 0, at: performance.now() - (j.ageMs || 0), found: true };
        titleEl.textContent = j.title || "";
        artistEl.textContent = j.artist || "";
        totalEl.textContent = fmt(track.duration);
        card.classList.toggle("paused", !j.playing);
        card.classList.remove("hidden");
        if (changed) loadArt(artUrl(j.coverArtHash, j.ytVideoId));
      } catch { /* keep last frame */ }
    }

    let raf = 0;
    function frame() {
      if (track.found) {
        let pos = track.pos + (track.playing ? (performance.now() - track.at) / 1000 : 0);
        if (track.duration) pos = Math.min(pos, track.duration);
        fillEl.style.width = (track.duration ? (pos / track.duration) * 100 : 0) + "%";
        elapsedEl.textContent = fmt(pos);
      }
      raf = requestAnimationFrame(frame);
    }

    resetArt();
    poll();
    const iv = setInterval(poll, 1000);
    raf = requestAnimationFrame(frame);
    return () => { clearInterval(iv); cancelAnimationFrame(raf); };
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div id="np" ref={rootRef}>
        <div className="card hidden">
          <div className="art" />
          <div className="info">
            <div className="titlerow">
              <span className="eq"><span /><span /><span /><span /></span>
              <span className="title">—</span>
            </div>
            <div className="artist">—</div>
            <div className="bar"><div className="fill" /></div>
            <div className="times"><span className="elapsed">0:00</span><span className="total">0:00</span></div>
          </div>
        </div>
      </div>
    </>
  );
}
