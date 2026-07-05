# Auto-end idle listening party — Design

**Date:** 2026-07-05
**Status:** Approved, pending implementation plan

## Problem

The listening party (ainul broadcasts, others follow) stays `active = true`
indefinitely once started. If ainul pauses and walks away, closes the tab, her
laptop sleeps, or the machine crashes, the party lingers forever. We want it to
turn itself off after a while of no music playing.

## Requirements

- Auto-end an active party when it has been idle for **30 minutes**.
- "Idle" covers **both**:
  - **Paused** — music has not been actively playing for the timeout (even if
    ainul's tab is still open and heartbeating).
  - **Disconnected** — ainul's browser stopped sending updates (tab closed,
    laptop asleep, crash).
- Robust against crashes: a party left `active` by a crash must get cleaned up
  after restart.

## Idle model

Track a single timestamp, **`lastPlayingAt`** = the last moment the party was
actually playing.

- Refreshed to `now` on any update where `isPlaying === true`.
- **Not** refreshed on paused updates, so a paused heartbeat cannot keep the
  party alive.
- Idle ⇔ `now − lastPlayingAt > IDLE_TIMEOUT_MS` (30 min).

This one rule covers both required cases:

| Scenario | Behaviour |
|---|---|
| Playing normally | `lastPlayingAt` keeps refreshing → never idle |
| Paused (tab open or not) | stops refreshing → ends 30 min after pause |
| Disconnected while playing | frozen at last playing moment → ends 30 min later |
| Disconnected while paused | frozen → ends 30 min later |
| Fresh party, still picking first song | `lastPlayingAt = startedAt` → full 30 min grace |

## Components

### 1. Schema — `prisma/schema.prisma`

Add to `model ListeningParty`:

```prisma
lastPlayingAt DateTime @default(now())
```

Non-null with a `now()` default. Stored in the DB (not module memory) so it
survives process restarts — this is what makes crash cleanup work: a
pre-crash party's `lastPlayingAt` is already old, so it reads as idle.

Migration name: `party_last_playing_at`.

### 2. Idle rule — `src/server/services/party-service.ts`

- `const IDLE_TIMEOUT_MS = 30 * 60 * 1000;`
- `startParty`: set `lastPlayingAt` to `now` on create (full grace regardless
  of initial `isPlaying`).
- `updateParty`: set `lastPlayingAt = now` **only when `input.isPlaying === true`**;
  otherwise leave the column untouched.
- Helper `isIdle(row)`: `Date.now() - row.lastPlayingAt.getTime() > IDLE_TIMEOUT_MS`.

### 3. Lazy check (live UX) — `getActiveParty()`

Before returning the active row, if `isIdle(row)`:
- mark it `active = false, endedAt = now`,
- `clearFollowers()`,
- `emit(null)`,
- return `null`.

Because `getActiveParty()` is already invoked on every receiver poll
(`GET /api/party`), every SSE connect (`/api/party/stream`), and every
follow/unfollow, no connected client ever observes a zombie party.

### 4. Background sweep (crash-proof safety net)

New in `party-service.ts`:

- `endIdleParties(): Promise<number>` — a single
  `db.listeningParty.updateMany({ where: { active: true, lastPlayingAt < cutoff }, ... })`.
  If it ended ≥ 1 party, `clearFollowers()` + `emit(null)`. Returns the count.
- `startPartyIdleSweeper()` — guarded by a module-level flag (same pattern as
  `activeWatcher` in the library scanner) so it can only start once. Runs
  `endIdleParties()` immediately on boot (clears stale parties left by a
  crash), then on a 60s `setInterval`.

Registered in `src/instrumentation.ts` `register()` alongside the existing
workers (chokidar watcher, metadata worker, `resetStuckDownloads`), inside the
existing `NEXT_RUNTIME === "nodejs"` guard.

### 5. Client

No new UI expected. Auto-end yields the same `null` party state as a manual
`endParty()`, which the receiver and broadcaster already handle. One edge to
**verify during implementation** (not assume): if ainul's tab is still open
and broadcasting when the party idles out, confirm her client reacts to the
`null` state correctly (stops its PATCH loop / shows the party as ended) — the
same way it does when she ends the party manually.

## Testing

Vitest unit tests (`npm test`) for `party-service`:

1. `updateParty` with `isPlaying: true` refreshes `lastPlayingAt`.
2. `updateParty` with `isPlaying: false` does **not** refresh `lastPlayingAt`.
3. `getActiveParty` ends a party whose `lastPlayingAt` is older than the
   timeout (paused-past-timeout and disconnected-frozen both reduce to this)
   and returns `null`.
4. `getActiveParty` does **not** end an actively-playing or fresh party.
5. `endIdleParties` ends only active rows past the cutoff and returns the count;
   emits `null` when it ends something.

## Out of scope (YAGNI)

- Per-user / per-follower idle tracking.
- Configurable timeout in the UI.
- "Are you still listening?" prompts before ending.
- Push/WhatsApp notification when a party auto-ends.
