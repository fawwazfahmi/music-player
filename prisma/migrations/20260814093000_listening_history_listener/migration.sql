-- AlterTable
ALTER TABLE "ListeningHistory" ADD COLUMN     "listener" TEXT;

-- Backfill. Every play recorded before this column existed belongs to ainul
-- (kyo) — confirmed by the account owner; fawwaz has barely used kyote. This
-- is a one-time attribution: the information was never captured at the time,
-- so it cannot be recovered or corrected from data later.
UPDATE "ListeningHistory" SET "listener" = 'ainul' WHERE "listener" IS NULL;

-- CreateIndex
CREATE INDEX "ListeningHistory_listener_playedAt_idx" ON "ListeningHistory"("listener", "playedAt");
