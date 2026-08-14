# Kyowave on iPhone — installable app + swipe-up now playing

**Date:** 2026-08-14
**Status:** Approved, ready to implement

> Brand name is **Kyowave**. Never `KyoWave`, never `Kyowave.` outside the
> logotype (where the period is a styled `<span>`, not part of the name).

## Problem

Kyowave is desktop-shaped. ainul wants it on her iPhone home screen, and wants
to reach lyrics and the video without hunting for them.

Three things are actually broken on a phone today, only one of which is layout:

1. **`SongRow` is a six-column fixed grid.** `grid-cols-[36px_36px_1fr_1fr_48px_32px]`
   at 390px leaves title and album about 55px each. Both ellipse to nothing.
2. **Every track menu is unreachable by finger.** `opacity-0 group-hover:opacity-100`
   has no touch equivalent. Change cover, re-transcribe, add-to-playlist, delete —
   none of them can be opened on a phone, on any track, anywhere. Same for the
   retry button on a failed download and the play button on Home's recent rows.
3. **The lock screen shows a blank square for YouTube-sourced tracks.**
   `updateMediaMetadata` sends `artwork: []` whenever `coverArtHash` is null,
   even though the app itself renders the YouTube thumbnail via `coverUrl()`.

Everything else is in better shape than expected: Albums, Artists and Home
already use `grid-cols-2` at base, the session cookie is a one-year persistent
cookie, and audio is a plain `<audio>` element hitting `/api/audio/{id}` — the
YouTube iframe is muted and decorative, so iOS's autoplay restrictions never
touch playback.

## Non-goals

- **Service worker / offline.** Every byte of audio streams from the Mac mini.
  An offline shell would show an empty library. Skip it.
- **Stats, Settings internals, Downloads, the YouTube picker at 390px.** Scope is
  listening and browsing. These stay desktop-shaped and merely usable.
- **A custom Dynamic Island widget.** Not possible. See below.
- **Desktop behaviour changes.** Every change is additive behind a breakpoint or
  a touch check. The ≥768px experience is byte-identical except for the
  MediaSession fix, which improves it too.

## What the Dynamic Island can and cannot do

A web app **cannot** post a Live Activity — that is ActivityKit, native only,
with no web API.

What iOS *does* give, automatically, is the standard Now Playing treatment
whenever audio plays: app icon plus live waveform in the Island, expanding to
artwork / title / artist / scrubber, mirrored on the lock screen and in Control
Center. It is driven entirely by the **MediaSession API**, which the app already
implements — so this works today, imperfectly.

Two things make it better, both in scope:

- **Installing to the home screen changes the icon in the Island** from Safari's
  compass to the Kyowave mark. This is the strongest practical reason to install.
- **Fixing the artwork payload** (below) is the difference between a grey square
  and the album cover on her lock screen.

---

## 1. Install (PWA)

### Detection

The hint renders only when **all three** hold:

```
isIOS       /iPhone|iPod/.test(ua)
            || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
notInstalled  !matchMedia('(display-mode: standalone)').matches
              && !(navigator as any).standalone
notDismissed  localStorage['kyowave:install-hint-dismissed'] !== '1'
```

The `Macintosh + maxTouchPoints` clause is load-bearing: since iPadOS 13 an iPad
reports itself as a Mac, and without it iPads never see the hint. Desktop Safari
reports `maxTouchPoints === 0`, so it is not caught by this.

### Behaviour

- Bottom sheet, one line of copy, an inline Share glyph, a **Got it** button.
- Appears once, ~2s after first paint, only on iOS, only when not installed.
- Dismissal is permanent. The sheet disappears by itself once installed, because
  `display-mode: standalone` then matches.
- Copy is four short lines, no paragraph:
  `Add Kyowave to your home screen` / `Tap ⎋ Share` / `Then Add to Home Screen`.

### Metadata and chrome

- `layout.tsx` gains `viewport = { width: 'device-width', initialScale: 1,
  viewportFit: 'cover', themeColor: '#09090b' }`.
- `appleWebApp: { capable: true, title: 'Kyowave', statusBarStyle: 'black-translucent' }`.
- `manifest.webmanifest` gains `"id": "/"` and `"scope": "/"` so iOS and Chrome
  treat the installed app as one stable identity across future deploys.
- **Zoom stays enabled.** No `maximum-scale=1`; disabling pinch-zoom is an
  accessibility regression. iOS's auto-zoom-on-focus is prevented the correct
  way instead: every text input is **≥16px** on mobile.
- Safe areas: the mini player and sheet pad with `env(safe-area-inset-bottom)`,
  the mobile header with `env(safe-area-inset-top)`.

---

## 2. The now-playing surface (mobile only, <768px)

Desktop keeps `PlayerBar` + right panel exactly as-is. Below 768px both are
replaced by two new components.

### `MiniPlayer` — the collapsed bar

Layout, left to right: 44px art, title over artist, heart, play/pause, skip.
A 2px sky progress hairline across the top edge. ~56px tall plus safe-area
padding.

- Swipe up **or** tap anywhere that isn't a button opens the sheet.
- **Volume is gone on mobile.** iOS makes `HTMLMediaElement.volume` read-only —
  the slider currently occupies a third of the player bar and does literally
  nothing on an iPhone. Hardware buttons only.
- Shuffle, repeat, scrub and the performance toggle move into the sheet.

### `NowPlayingSheet` — the expanded sheet

Top to bottom:

| Region | Notes |
|---|---|
| Grab handle | The whole slot area is draggable, not just the 32px handle |
| Media slot | 16:9 video, **or** a 150px centred square of album art |
| Tabs | Lyrics · Queue |
| Lyrics / Queue | Fills remaining height, scrolls |
| Bottom block | Title + artist + heart, scrub + times, shuffle ⏮ ▶ ⏭ repeat |

Controls sit **below** the lyrics — thumb reach, and the lyrics gain the ~70px
they'd otherwise lose.

**The bolt chip**, top-right of the media slot, is the same `BoltIcon`
performance mode uses, so it reads as one idea: **bolt lit = no video.**

- Outlined = video. Filled sky = album art.
- Album art is 150px tall, not 219px, so **art mode hands ~69px (about three
  lines) to the lyrics.** Everything below the slot is identical between the two
  states, so toggling slides the lyrics and moves nothing else.
- Performance mode forces it lit and locks it. Otherwise it is hers to toggle,
  persisted as `mobileArtMode` in the player store.

Dismissal: swipe down from anywhere in the top region, or the handle. Escape
also closes it (for desktop-width testing).

### Video slot precedence

`VideoStage.findActiveSlot()` currently checks `big` then `small`. It gains a
third name checked **first**:

```
sheet  →  big  →  small
```

`sheet` only exists in the DOM while the mobile sheet is open, so there is no
ambiguity with `nowPlayingFull`'s `big` slot.

---

## 3. Battery, backgrounding and the audio gate

This is the highest-risk area. The rule that prevents the entire bug class:

> **On mobile, audio is never gated on video.**

`AppShell` currently runs `if (isPlaying && !videoLoading) engine.play()`. If
`videoLoading` is ever left true while the iframe is being torn down, her music
stops and does not restart. This is precisely the deadlock performance mode hit
on first release.

Implementation:

- The player store gains **`videoGateEnabled: boolean`** (default `true`, not
  persisted). `AppShell` sets it `false` on mobile at mount. Every existing
  `videoLoading: !!track.ytVideoId && !performanceMode` assignment gains
  `&& get().videoGateEnabled`. One flag, one place, whole class gone.
- `teardownVideoStage()` additionally forces `videoLoading: false`, so no
  unmount path can strand the gate.

### When the iframe is mounted

`<VideoStage />` mounts only when **all** hold:

```
!performanceMode
&& (!isMobile || (sheetOpen && !artMode && documentVisible))
```

So on a phone the iframe does not exist while the sheet is closed, while art
mode is on, or while the app is backgrounded. It costs ~500ms to rebuild when
she reopens the sheet, which is the correct trade against decoding video for a
whole listening session to render a picture nobody is looking at.

### Screen lock

- `visibilitychange → hidden`: `documentVisible` goes false, `<VideoStage />`
  unmounts, iframe destroyed. **Audio continues** — it is a plain `<audio>`
  element and iOS keeps it alive, with lock-screen transport via MediaSession.
- `visibilitychange → visible`: if the sheet is still open and art mode is off,
  the stage remounts and seeks to the audio's current position, which
  `YtVideoPanel` already does via `positionRef`.
- `pagehide` is handled alongside `visibilitychange`, because iOS does not fire
  `visibilitychange` reliably on lock in every version.

---

## 4. MediaSession fix (ships regardless of viewport)

`src/audio/media-session.ts`:

1. **Artwork fallback.** Use the same resolution the UI uses — `coverUrl(hash,
   ytVideoId)` — so a track with no `coverArtHash` falls back to its YouTube
   thumbnail instead of sending `artwork: []`.
2. **Three sizes, not one.** `96×96`, `256×256`, `512×512`. iOS picks by size;
   handing it a lone 500×500 to downsample is visibly softer in the compact
   Island.
3. **`setPositionState()`.** Called on load and whenever the playhead moves by
   more than a second, plus on seek and pause. Without it the lock-screen
   scrubber does not track the song. Wrapped in try/catch — it throws if
   `position > duration`, which happens transiently on track change.

---

## 5. `SongRow` at 390px

CSS-only responsive — **no JS breakpoint**, so there is no hydration mismatch
and no flash of the wrong layout.

- Container: `flex` at base, `md:grid md:grid-cols-[…]` unchanged above 768px.
- Track number, album column and duration column: `hidden md:block`.
- The artist line gains a `md:hidden` span so mobile reads
  `Grimes · Visions · 4:12` on one line. Album and duration are not lost, just
  relocated.
- Art grows 36px → 44px, row height → 48px: a real tap target.

---

## 6. Track menu on touch — long-press, taught then retired

Long-press (450ms) on a row opens the menu. Three layers teach it, each
retiring itself.

### Layer 1 — coach mark, once ever

First song list opened on a touch device. Scrim, the first row spotlit, four
words: **Hold for options**, subtitle `cover, lyrics, playlists, delete`, one
**Got it** button. Tap anywhere dismisses.
Key: `kyowave:coach-longpress-seen`.

### Layer 2 — training-wheel ⋮, first three menu opens

The ⋮ is visible and works. **Crucially, the menu it opens carries a one-line
footer:** *"Faster next time — hold a song to open this."* A visible button she
can tap forever would mean she never learns the gesture, so the button has to
teach while it serves.
Key: `kyowave:longpress-count` (incremented only by successful long-presses).

### Layer 3 — learned

At count ≥ 3 the ⋮ retires and the tip stops rendering. Rows get full title
width.

### Feedback

**iOS Safari has no vibration API** — `navigator.vibrate` has never worked
there. Feedback must be visual: the row scales to 0.965 and a ring fills over
the 450ms hold.

### Settings escape hatch

One row: `Track menu button — Always · Until learned · Never`, default
**Until learned**, key `kyowave:menu-button-pref`. Covers "it's been three
months and she forgot" without a deploy.

### Two details that decide whether this feels good or broken

- The row needs `-webkit-touch-callout: none` and `user-select: none`, or iOS
  pops its own copy/lookup bubble on top of the menu.
- The hold timer **must cancel on finger movement > 8px** and on scroll, or
  scrolling the list fires menus the whole way down.

### Menu presentation

`TrackMenu` becomes optionally **controlled** (`open` / `onOpenChange`) so
long-press can drive it, and gains `hideButton`. On mobile it renders as a
bottom sheet **through a portal** rather than an absolutely-positioned dropdown
— the player bar's `backdrop-blur` creates a containing block for `position:
fixed`, which would otherwise trap it.

---

## 7. Other touch fixes

- `HomePage.tsx` recent-row play button: `opacity-0` → `opacity-100 md:opacity-0`.
- `DownloadsPage.tsx` retry button: same.
- Search input: `text-base` (16px) on mobile so iOS does not auto-zoom on focus.
- Sticky headers on Search and list pages.
- `overscroll-behavior: none` on the sheet so pulling past the end of the lyrics
  does not rubber-band the page behind it.

---

## Testing

**Automated (vitest):**

- `lib/mobile.ts` — iOS detection incl. the iPadOS `Macintosh + maxTouchPoints`
  case; desktop Safari (`maxTouchPoints: 0`) must **not** match; standalone
  detection via both `matchMedia` and `navigator.standalone`; learning-state
  transitions across the three `menu-button-pref` values.
- `use-long-press` — fires at 450ms; cancelled by move > 8px, by touchend
  before threshold, by touchcancel; does not fire twice.
- `media-session` — artwork falls back to the YouTube thumbnail when
  `coverArtHash` is null; emits three sizes; `setPositionState` is not called
  with `position > duration`.
- `player-store` — `videoGateEnabled: false` keeps `videoLoading` false through
  every transition that would otherwise set it.

**Manual, in a 390×844 viewport:** install hint appears and dismisses
permanently; swipe up opens the sheet and swipe down closes it; bolt toggles art
and the lyrics grow; long-press opens the menu and scrolling does not; the ⋮
retires after three long-presses; audio keeps playing when the tab is hidden and
does not stall when it returns.

**Regression floor:** at ≥768px every screen must be pixel-identical to `main`
apart from the MediaSession change.

## Rollout

Single branch `feat/mobile-pwa`, merged to `main`, deployed via
`scripts/deploy.sh` (preflight → migrate → build → **restart** → verify). No
database migration is required — nothing here touches Prisma.

A patch-notes entry ships with it, since the release is user-visible.
